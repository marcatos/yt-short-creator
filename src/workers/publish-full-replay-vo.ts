import path from "node:path";

import type { ReplaySession, YoutubePrivacy } from "@/src/domain/entities";
import type {
  VoiceOverLanguage,
  VoiceOverPackage,
} from "@/src/domain/voice-over";
import {
  createVoiceOverPublishSidecar,
  loadVoiceOverPublishSidecar,
  priorFullVoiceOverJobCheckpoints,
  resolveVoiceOverUploadCheckpoint,
  uploadCheckpointFromJob,
  type VoiceOverUploadCheckpoint,
} from "@/src/application/voice-over-publish-checkpoint";
import type { GenerateFullVoiceOvers } from "@/src/application/generate-full-voice-overs";
import type { ClockPort } from "@/src/ports/clock";
import type { FullVoMixPort } from "@/src/ports/full-vo-mix";
import type { InspectableJobQueue } from "@/src/ports/job-queue";
import type { Logger } from "@/src/ports/logger";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";
import type { SettingsRepository } from "@/src/ports/settings-repository";
import type { YouTubeAuthPort } from "@/src/ports/youtube-auth";
import type { YouTubeCaptionsPort } from "@/src/ports/youtube-captions";
import type { YouTubeUploadPort } from "@/src/ports/youtube-upload";

import type { JobHandlerContext } from "./job-handler-context";
import { runStep } from "./run-step";
import { currentYouTubeAccessToken } from "./youtube-access-token";

export type FullVoiceOverPublishDeps = {
  logger: Logger;
  replaySessions: ReplaySessionRepository;
  mediaStore: MediaStorePort;
  settings?: SettingsRepository;
  auth: YouTubeAuthPort;
  upload: YouTubeUploadPort;
  captions?: YouTubeCaptionsPort;
  queue?: InspectableJobQueue;
  generateFullVoiceOvers?: GenerateFullVoiceOvers;
  fullVoMix?: FullVoMixPort;
  clock: ClockPort;
};

const JOB_TYPE = "publish_full_replay";
const LANGUAGES: VoiceOverLanguage[] = ["it", "en"];

/** Progress bands per language so the pair reports one continuous bar. */
const LANGUAGE_PROGRESS: Record<VoiceOverLanguage, { mix: number; upload: number; captions: number }> = {
  it: { mix: 62, upload: 70, captions: 78 },
  en: { mix: 82, upload: 90, captions: 100 },
};

function packageFor(
  session: ReplaySession,
  language: VoiceOverLanguage,
): VoiceOverPackage {
  const voiceOver = (session.fullVoiceOvers ?? []).find(
    (item) => item.language === language,
  );
  if (!voiceOver) {
    throw new Error(
      `Full-race voice-over package "${language}" not found for session: ${session.id}`,
    );
  }
  return voiceOver;
}

async function requireSession(
  deps: FullVoiceOverPublishDeps,
  sessionId: string,
): Promise<ReplaySession> {
  const session = await deps.replaySessions.getById(sessionId);
  if (!session) throw new Error(`Replay session not found: ${sessionId}`);
  return session;
}

/** Narration length drives the duck release so the race is not left 12 dB down. */
function narrationDurationMs(voiceOver: VoiceOverPackage): number | undefined {
  const lastWord = voiceOver.words[voiceOver.words.length - 1];
  return lastWord && lastWord.endMs > 0 ? lastWord.endMs : undefined;
}

function recoveredPackage(input: {
  checkpoint: VoiceOverUploadCheckpoint;
  voiceProfile: string;
  audioPath: string;
}): VoiceOverPackage {
  const parsedAudioPath = path.parse(input.audioPath);
  return {
    language: input.checkpoint.language,
    script: "",
    title: "",
    description: "",
    voiceProfile: input.voiceProfile,
    audioPath: input.audioPath,
    words: [],
    srtPath: path.join(
      parsedAudioPath.dir,
      `${parsedAudioPath.name}.srt`,
    ),
    assPath: null,
    scriptHash: input.checkpoint.scriptHash,
    youtubeVideoId: input.checkpoint.youtubeVideoId,
    ...(input.checkpoint.youtubeCaptionId
      ? { youtubeCaptionId: input.checkpoint.youtubeCaptionId }
      : {}),
  };
}

/** Reloads the session so concurrent writes are not clobbered. */
async function patchVoiceOver(
  deps: FullVoiceOverPublishDeps,
  sessionId: string,
  language: VoiceOverLanguage,
  patch: Partial<VoiceOverPackage>,
  sessionPatch: Partial<ReplaySession> = {},
): Promise<ReplaySession> {
  const fresh = await requireSession(deps, sessionId);
  packageFor(fresh, language);
  const updated: ReplaySession = {
    ...fresh,
    ...sessionPatch,
    fullVoiceOvers: (fresh.fullVoiceOvers ?? []).map((voiceOver) =>
      voiceOver.language === language ? { ...voiceOver, ...patch } : voiceOver,
    ),
    updatedAt: deps.clock.now(),
  };
  await deps.replaySessions.save(updated);
  return updated;
}

export async function runFullVoiceOverPublish(
  ctx: JobHandlerContext,
  deps: FullVoiceOverPublishDeps,
  input: { sessionId: string; privacy: YoutubePrivacy; encodePath: string },
): Promise<void> {
  const { sessionId, privacy } = input;
  const log = deps.logger.child({ component: "PublishFullReplayVoiceOver" });
  const generate = deps.generateFullVoiceOvers;
  const mixer = deps.fullVoMix;
  if (!generate || !mixer) {
    throw new Error(
      "Full-race voice-over publishing requires the voice-over generator and mixer adapters",
    );
  }
  const voRenderPath = deps.mediaStore.fullReplayVoRenderPath?.bind(
    deps.mediaStore,
  );
  const voPath = deps.mediaStore.fullReplayVoPath?.bind(deps.mediaStore);
  if (!voRenderPath) {
    throw new Error("Media store does not support full-race voice-over renders");
  }
  if (!voPath) {
    throw new Error("Media store does not support full-race voice-over audio");
  }
  const appSettings = await deps.settings?.get();
  const priorCheckpoints = priorFullVoiceOverJobCheckpoints({
    jobs: deps.queue?.listJobs() ?? [],
    currentJobId: ctx.jobId,
    sessionId,
  });

  const beforeGeneration = await requireSession(deps, sessionId);
  const sidecars = await Promise.all(
    LANGUAGES.map(async (language) => [
      language,
      await loadVoiceOverPublishSidecar({
        ownerId: sessionId,
        language,
        sidecarPath: deps.mediaStore.fullVoPublishCheckpointPath?.(
          sessionId,
          language,
        ),
        mediaStore: deps.mediaStore,
        logger: log,
      }),
    ] as const),
  );
  const recoveredByLanguage = new Map(sidecars);
  let restoredCount = 0;
  const restoredPackages = [...(beforeGeneration.fullVoiceOvers ?? [])];
  for (const language of LANGUAGES) {
    const existingIndex = restoredPackages.findIndex(
      (voiceOver) => voiceOver.language === language,
    );
    const existing =
      existingIndex === -1 ? undefined : restoredPackages[existingIndex];
    const durableCandidates = [
      recoveredByLanguage.get(language),
      uploadCheckpointFromJob(ctx.checkpoint, language),
      ...priorCheckpoints.map((checkpoint) =>
        uploadCheckpointFromJob(checkpoint, language),
      ),
    ].filter(
      (checkpoint): checkpoint is VoiceOverUploadCheckpoint =>
        checkpoint !== null && checkpoint !== undefined,
    );
    const durable = durableCandidates[0];
    if (!durable || existing?.youtubeVideoId) continue;
    if (existing && existing.scriptHash !== durable.scriptHash) {
      log.warn("Ignored full-race upload checkpoint for a different script", {
        sessionId,
        language,
        packageScriptHash: existing.scriptHash,
        checkpointScriptHash: durable.scriptHash,
      });
      continue;
    }
    const restored = existing
      ? {
          ...existing,
          youtubeVideoId: durable.youtubeVideoId,
          ...(durable.youtubeCaptionId
            ? { youtubeCaptionId: durable.youtubeCaptionId }
            : {}),
        }
      : recoveredPackage({
          checkpoint: durable,
          voiceProfile: appSettings?.brandVoiceProfile ?? "",
          audioPath: voPath(sessionId, language),
        });
    if (existingIndex === -1) restoredPackages.push(restored);
    else restoredPackages[existingIndex] = restored;
    restoredCount += 1;
    log.info("Restored full-race voice-over before generation", {
      sessionId,
      language,
      scriptHash: durable.scriptHash,
      youtubeVideoId: durable.youtubeVideoId,
    });
  }
  if (restoredCount > 0) {
    await deps.replaySessions.save({
      ...beforeGeneration,
      fullVoiceOvers: restoredPackages,
      updatedAt: deps.clock.now(),
    });
  }

  await runStep(ctx, JOB_TYPE, "voice_over", async () => {
    const settled = (await requireSession(deps, sessionId)).fullVoiceOvers ?? [];
    if (
      LANGUAGES.every((language) =>
        settled.some(
          (voiceOver) =>
            voiceOver.language === language && voiceOver.youtubeVideoId,
        ),
      )
    ) {
      ctx.setProgress(58, "Reusing published IT/EN narration");
      log.info("Full-race voice-over generation skipped (all published)", {
        sessionId,
      });
      return;
    }
    ctx.setProgress(58, "Writing and synthesizing IT/EN narration");
    const packages = await generate({ sessionId });
    log.info("Full-race voice-over packages ready", {
      sessionId,
      languages: packages.map(({ language }) => language),
    });
  });

  for (const language of LANGUAGES) {
    const progress = LANGUAGE_PROGRESS[language];
    const label = language.toUpperCase();
    const current = await requireSession(deps, sessionId);
    const sidecar = createVoiceOverPublishSidecar({
      ownerId: sessionId,
      voiceOver: packageFor(current, language),
      sidecarPath: deps.mediaStore.fullVoPublishCheckpointPath?.(
        sessionId,
        language,
      ),
      mediaStore: deps.mediaStore,
      logger: log,
    });
    const recovered = resolveVoiceOverUploadCheckpoint(
      packageFor(current, language),
      await sidecar.load(),
      ctx.checkpoint,
      priorCheckpoints,
    );
    if (recovered?.youtubeVideoId) {
      await patchVoiceOver(
        deps,
        sessionId,
        language,
        {
          youtubeVideoId: recovered.youtubeVideoId,
          ...(recovered.youtubeCaptionId
            ? { youtubeCaptionId: recovered.youtubeCaptionId }
            : {}),
        },
        language === "it" && !current.fullVideoYoutubeId
          ? { fullVideoYoutubeId: recovered.youtubeVideoId }
          : {},
      );
      log.info("Recovered full-race voice-over upload from checkpoint", {
        sessionId,
        language,
        youtubeVideoId: recovered.youtubeVideoId,
      });
    }

    await runStep(ctx, JOB_TYPE, `mix_${language}`, async () => {
      const voiceOver = packageFor(
        await requireSession(deps, sessionId),
        language,
      );
      // A recovered upload means the narrated encode already reached YouTube;
      // re-mixing a 40-minute race for it would burn hours for nothing.
      if (voiceOver.youtubeVideoId) {
        ctx.setProgress(
          progress.mix,
          `${label} already published as ${voiceOver.youtubeVideoId}`,
        );
        log.info("Full-race voice-over mix skipped (already published)", {
          sessionId,
          language,
          youtubeVideoId: voiceOver.youtubeVideoId,
        });
        return;
      }
      if (voiceOver.renderOutputPath) {
        ctx.setProgress(
          progress.mix,
          `Reusing ${label} narrated encode`,
        );
        return;
      }
      ctx.setProgress(progress.mix, `Mixing ${label} narration onto the race`);
      const outputPath = voRenderPath(sessionId, language);
      const voiceDurationMs = narrationDurationMs(voiceOver);
      const result = await mixer.mix({
        videoPath: input.encodePath,
        voiceAudioPath: voiceOver.audioPath,
        outputPath,
        voiceDuckDb: appSettings?.voiceDuckDb,
        ...(voiceDurationMs === undefined ? {} : { voiceDurationMs }),
        burnInCaptions: appSettings?.fullBurnInCaptions ?? false,
        ...(voiceOver.srtPath ? { subtitlesPath: voiceOver.srtPath } : {}),
      });
      await patchVoiceOver(deps, sessionId, language, {
        renderOutputPath: result.outputPath,
      });
      log.info("Full-race voice-over mix done", {
        sessionId,
        language,
        outputPath: result.outputPath,
        burnedInCaptions: result.burnedInCaptions,
        durationMs: result.durationMs,
      });
    });

    await runStep(ctx, JOB_TYPE, `upload_${language}`, async () => {
      const session = await requireSession(deps, sessionId);
      const voiceOver = packageFor(session, language);
      if (voiceOver.youtubeVideoId) {
        if (language === "it" && !session.fullVideoYoutubeId) {
          await patchVoiceOver(
            deps,
            sessionId,
            language,
            {},
            { fullVideoYoutubeId: voiceOver.youtubeVideoId },
          );
        }
        ctx.setProgress(
          progress.upload,
          `${label} already on YouTube as ${voiceOver.youtubeVideoId}`,
        );
        return;
      }
      if (!voiceOver.renderOutputPath) {
        throw new Error(`Missing ${language} narrated encode for ${sessionId}`);
      }
      ctx.setProgress(progress.upload, `Uploading ${label} full race`);
      const result = await deps.upload.upload({
        accessToken: await currentYouTubeAccessToken(
          deps.auth,
          deps.clock.now(),
        ),
        filePath: voiceOver.renderOutputPath,
        title: voiceOver.title.slice(0, 100),
        description: voiceOver.description,
        tags: (session.racePackage?.fullVideo.tags ?? []).slice(0, 15),
        scheduledAt: null,
        privacy,
        contentKind: "full",
      });
      const checkpoint: VoiceOverUploadCheckpoint = {
        language,
        scriptHash: voiceOver.scriptHash,
        youtubeVideoId: result.youtubeVideoId,
      };
      await ctx.saveCheckpoint(`upload_${language}`, checkpoint);
      await sidecar.save(checkpoint);
      await patchVoiceOver(
        deps,
        sessionId,
        language,
        { youtubeVideoId: result.youtubeVideoId },
        // The narrated Italian upload becomes the session's canonical full
        // video so the silent path never publishes the race a second time.
        language === "it" && !session.fullVideoYoutubeId
          ? { fullVideoYoutubeId: result.youtubeVideoId }
          : {},
      );
      log.info("Full-race voice-over uploaded", {
        sessionId,
        language,
        youtubeVideoId: result.youtubeVideoId,
        privacy,
      });
    });

    await runStep(ctx, JOB_TYPE, `captions_${language}`, async () => {
      if (!deps.captions) {
        throw new Error("YouTube captions adapter is not configured");
      }
      const voiceOver = packageFor(
        await requireSession(deps, sessionId),
        language,
      );
      if (voiceOver.youtubeCaptionId) {
        ctx.setProgress(progress.captions, `${label} captions already uploaded`);
        return;
      }
      if (!voiceOver.youtubeVideoId) {
        throw new Error(`YouTube video id missing for ${language} full race`);
      }
      if (!voiceOver.srtPath) {
        throw new Error(`Missing ${language} SRT for ${sessionId}`);
      }
      ctx.setProgress(progress.captions, `Uploading ${label} captions`);
      const caption = await deps.captions.upload({
        accessToken: await currentYouTubeAccessToken(
          deps.auth,
          deps.clock.now(),
        ),
        youtubeVideoId: voiceOver.youtubeVideoId,
        filePath: voiceOver.srtPath,
        language,
        name: "VO",
      });
      const captionsCheckpoint: VoiceOverUploadCheckpoint = {
        language,
        scriptHash: voiceOver.scriptHash,
        youtubeVideoId: voiceOver.youtubeVideoId,
        youtubeCaptionId: caption.youtubeCaptionId,
      };
      await ctx.saveCheckpoint(`captions_${language}`, captionsCheckpoint);
      await sidecar.save(captionsCheckpoint);
      await patchVoiceOver(
        deps,
        sessionId,
        language,
        { youtubeCaptionId: caption.youtubeCaptionId },
        language === "en"
          ? {
              fullVideoPrivacy: privacy,
              fullVideoPublishedAt: deps.clock.now(),
            }
          : {},
      );
      log.info("Full-race voice-over captions uploaded", {
        sessionId,
        language,
        youtubeCaptionId: caption.youtubeCaptionId,
      });
    });
  }
}
