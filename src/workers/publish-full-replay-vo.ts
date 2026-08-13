import path from "node:path";

import type { YoutubePrivacy } from "@/src/domain/entities";
import type {
  VoiceOverLanguage,
  VoiceOverPackage,
} from "@/src/domain/voice-over";
import type { PackageFullDeliveryAssets } from "@/src/application/package-full-delivery-assets";
import type { GenerateFullVoiceOvers } from "@/src/application/generate-full-voice-overs";
import type { ClockPort } from "@/src/ports/clock";
import type { FullVoMixPort } from "@/src/ports/full-vo-mix";
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
  generateFullVoiceOvers?: GenerateFullVoiceOvers;
  fullVoMix?: FullVoMixPort;
  packageFullDeliveryAssets?: PackageFullDeliveryAssets;
  clock: ClockPort;
  /** Unused by single-master path; kept for handler typing compatibility. */
  queue?: unknown;
};

const JOB_TYPE = "publish_full_replay";
const LANGUAGES: VoiceOverLanguage[] = ["it", "en"];

function packageFor(
  voiceOvers: VoiceOverPackage[] | null | undefined,
  language: VoiceOverLanguage,
): VoiceOverPackage {
  const voiceOver = (voiceOvers ?? []).find(
    (item) => item.language === language,
  );
  if (!voiceOver) {
    throw new Error(`Full-race voice-over package "${language}" not found`);
  }
  return voiceOver;
}

/**
 * Single-master publish: one YouTube video + localizations + captions.
 * Mixed IT/EN audio tracks stay on disk for Studio multi-audio attachment.
 */
export async function runFullVoiceOverPublish(
  ctx: JobHandlerContext,
  deps: FullVoiceOverPublishDeps,
  input: { sessionId: string; privacy: YoutubePrivacy; encodePath: string },
): Promise<void> {
  const { sessionId, privacy } = input;
  const log = deps.logger.child({
    component: "PublishFullReplaySingleMaster",
  });
  const generate = deps.generateFullVoiceOvers;
  const packageAssets = deps.packageFullDeliveryAssets;
  if (!generate || !packageAssets) {
    throw new Error(
      "Single-master publish requires VO generator and delivery packaging",
    );
  }

  await runStep(ctx, JOB_TYPE, "voice_over", async () => {
    ctx.setProgress(58, "Writing and synthesizing IT/EN narration");
    const packages = await generate({ sessionId });
    log.info("Full-race voice-over packages ready", {
      sessionId,
      languages: packages.map(({ language }) => language),
    });
  });

  await runStep(ctx, JOB_TYPE, "package_assets", async () => {
    ctx.setProgress(65, "Packaging master + multi-language audio assets");
    const session = await deps.replaySessions.getById(sessionId);
    if (!session?.raceAnalysis) {
      throw new Error(
        "Race analysis required before packaging delivery assets",
      );
    }
    if (!session.fullVoiceOvers?.length) {
      throw new Error("Voice-overs missing before packaging");
    }
    const bundle = await packageAssets({
      sessionId,
      masterSourcePath: input.encodePath,
      voiceOvers: session.fullVoiceOvers,
      analysis: session.raceAnalysis,
    });
    log.info("Delivery assets ready", {
      sessionId,
      masterVideoPath: bundle.masterVideoPath,
      checklist: bundle.metadata.manualStudioChecklist.length,
    });
  });

  await runStep(ctx, JOB_TYPE, "upload", async () => {
    const session = await deps.replaySessions.getById(sessionId);
    if (!session) throw new Error(`Replay session not found: ${sessionId}`);
    if (session.fullVideoYoutubeId) {
      ctx.setProgress(
        80,
        `Already on YouTube as ${session.fullVideoYoutubeId}`,
      );
      return;
    }
    const it = packageFor(session.fullVoiceOvers, "it");
    const masterPath =
      session.deliveryAssets?.masterVideoPath ?? input.encodePath;
    ctx.setProgress(72, "Uploading language-neutral master to YouTube");
    const accessToken = await currentYouTubeAccessToken(
      deps.auth,
      deps.clock.now(),
    );
    const result = await deps.upload.upload({
      accessToken,
      filePath: masterPath,
      title: it.title.slice(0, 100),
      description: it.description,
      tags: (session.racePackage?.fullVideo.tags ?? ["iRacing", "simracing"]).slice(
        0,
        15,
      ),
      scheduledAt: null,
      privacy,
      contentKind: "full",
      defaultLanguage: "it",
      defaultAudioLanguage: "it",
    });
    await deps.replaySessions.save({
      ...session,
      fullVideoYoutubeId: result.youtubeVideoId,
      fullVideoPrivacy: privacy,
      fullVideoPublishedAt: deps.clock.now(),
      fullVoiceOvers: (session.fullVoiceOvers ?? []).map((voiceOver) =>
        voiceOver.language === "it"
          ? { ...voiceOver, youtubeVideoId: result.youtubeVideoId }
          : voiceOver,
      ),
      updatedAt: deps.clock.now(),
    });
    await ctx.saveCheckpoint("upload", {
      youtubeVideoId: result.youtubeVideoId,
    });
    log.info("Single-master full race uploaded", {
      sessionId,
      youtubeVideoId: result.youtubeVideoId,
    });
  });

  await runStep(ctx, JOB_TYPE, "localizations", async () => {
    const session = await deps.replaySessions.getById(sessionId);
    if (!session?.fullVideoYoutubeId) {
      throw new Error("Missing YouTube video id before localizations");
    }
    const it = packageFor(session.fullVoiceOvers, "it");
    const en = packageFor(session.fullVoiceOvers, "en");
    if (!deps.upload.updateLocalizations) {
      log.warn("Upload adapter cannot set localizations; leaving Studio checklist");
      return;
    }
    ctx.setProgress(85, "Setting IT/EN title and description localizations");
    const accessToken = await currentYouTubeAccessToken(
      deps.auth,
      deps.clock.now(),
    );
    await deps.upload.updateLocalizations({
      accessToken,
      youtubeVideoId: session.fullVideoYoutubeId,
      defaultLanguage: "it",
      localizations: {
        it: { title: it.title, description: it.description },
        en: { title: en.title, description: en.description },
      },
    });
    await deps.replaySessions.save({
      ...session,
      fullVoiceOvers: (session.fullVoiceOvers ?? []).map((voiceOver) =>
        voiceOver.language === "en"
          ? { ...voiceOver, youtubeVideoId: session.fullVideoYoutubeId }
          : voiceOver,
      ),
      updatedAt: deps.clock.now(),
    });
    log.info("Localizations applied", {
      sessionId,
      youtubeVideoId: session.fullVideoYoutubeId,
    });
  });

  for (const language of LANGUAGES) {
    const step = `captions_${language}` as const;
    await runStep(ctx, JOB_TYPE, step, async () => {
      const session = await deps.replaySessions.getById(sessionId);
      if (!session?.fullVideoYoutubeId) {
        throw new Error("Missing YouTube video id before captions");
      }
      const voiceOver = packageFor(session.fullVoiceOvers, language);
      if (voiceOver.youtubeCaptionId) {
        ctx.setProgress(
          language === "it" ? 92 : 100,
          `${language.toUpperCase()} captions already uploaded`,
        );
        return;
      }
      if (!voiceOver.srtPath || !deps.captions) {
        log.warn("Skipping captions upload", {
          sessionId,
          language,
          hasSrt: Boolean(voiceOver.srtPath),
          hasCaptionsAdapter: Boolean(deps.captions),
        });
        return;
      }
      ctx.setProgress(
        language === "it" ? 92 : 98,
        `Uploading ${language.toUpperCase()} soft captions`,
      );
      const accessToken = await currentYouTubeAccessToken(
        deps.auth,
        deps.clock.now(),
      );
      const caption = await deps.captions.upload({
        accessToken,
        youtubeVideoId: session.fullVideoYoutubeId,
        language,
        filePath: voiceOver.srtPath,
        name: path.basename(voiceOver.srtPath),
      });
      await deps.replaySessions.save({
        ...session,
        fullVoiceOvers: (session.fullVoiceOvers ?? []).map((item) =>
          item.language === language
            ? { ...item, youtubeCaptionId: caption.youtubeCaptionId }
            : item,
        ),
        updatedAt: deps.clock.now(),
      });
      log.info("Captions uploaded", {
        sessionId,
        language,
        captionId: caption.youtubeCaptionId,
      });
    });
  }

  const finalSession = await deps.replaySessions.getById(sessionId);
  const checklist =
    finalSession?.publishManualChecklist ??
    finalSession?.deliveryAssets?.metadata.manualStudioChecklist ??
    [];
  ctx.setProgress(
    100,
    checklist.length
      ? `Published ${finalSession?.fullVideoYoutubeId}; Studio: ${checklist.length} step(s) remain`
      : `Published ${finalSession?.fullVideoYoutubeId}`,
  );
  log.info("Single-master full-race publish completed", {
    sessionId,
    youtubeVideoId: finalSession?.fullVideoYoutubeId ?? null,
    manualChecklistCount: checklist.length,
  });
}
