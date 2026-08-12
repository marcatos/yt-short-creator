import { applyCandidateEvent } from "@/src/domain/approval";
import type { ShortCandidate } from "@/src/domain/entities";
import { withFullVideoLink } from "@/src/domain/full-video-link";
import { isJobCancelledError, isJobPausedError } from "@/src/domain/queue-control";
import type {
  VoiceOverLanguage,
  VoiceOverPackage,
} from "@/src/domain/voice-over";
import type { JobCheckpoint } from "@/src/domain/queue-control";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { Logger } from "@/src/ports/logger";
import type { SettingsRepository } from "@/src/ports/settings-repository";
import type { SourceVideoRepository } from "@/src/ports/source-video-repository";
import type { YouTubeAuthPort } from "@/src/ports/youtube-auth";
import type { YouTubeCaptionsPort } from "@/src/ports/youtube-captions";
import type { YouTubeUploadPort } from "@/src/ports/youtube-upload";

import { requireStringPayload } from "./handler-utils";
import type { JobHandler } from "./job-handler-context";
import { runStep } from "./run-step";
import { currentYouTubeAccessToken } from "./youtube-access-token";

type Dependencies = {
  logger: Logger;
  candidates: CandidateRepository;
  settings: SettingsRepository;
  auth: YouTubeAuthPort;
  upload: YouTubeUploadPort;
  captions?: YouTubeCaptionsPort;
  clock: ClockPort;
  sourceVideos: SourceVideoRepository;
};

type VoiceOverPublishPayload = {
  language: VoiceOverLanguage;
  filePath: string;
  srtPath: string;
  title: string;
  description: string;
};

const JOB_TYPE = "publish_short";

type VoiceOverUploadCheckpoint = {
  language: VoiceOverLanguage;
  youtubeVideoId: string;
  youtubeCaptionId?: string;
};

function uploadResultFromCheckpoint(
  checkpoint: JobCheckpoint | null,
  language: VoiceOverLanguage,
): VoiceOverUploadCheckpoint | null {
  if (
    (checkpoint?.step !== "upload" && checkpoint?.step !== "captions") ||
    typeof checkpoint.data !== "object" ||
    checkpoint.data === null
  ) {
    return null;
  }
  const data = checkpoint.data as Record<string, unknown>;
  if (
    data.language !== language ||
    typeof data.youtubeVideoId !== "string" ||
    data.youtubeVideoId.length === 0
  ) {
    return null;
  }
  return {
    language,
    youtubeVideoId: data.youtubeVideoId,
    ...(typeof data.youtubeCaptionId === "string" &&
    data.youtubeCaptionId.length > 0
      ? { youtubeCaptionId: data.youtubeCaptionId }
      : {}),
  };
}

export function hasVoiceOverPublishPayload(
  payload: Record<string, unknown>,
): boolean {
  return payload.language !== undefined;
}

function parsePayload(
  payload: Record<string, unknown>,
): VoiceOverPublishPayload {
  const language = payload.language;
  if (language !== "it" && language !== "en") {
    throw new Error('Job payload "language" must be "it" or "en"');
  }
  return {
    language,
    filePath: requireStringPayload(payload, "filePath"),
    srtPath: requireStringPayload(payload, "srtPath"),
    title: requireStringPayload(payload, "title"),
    description: requireStringPayload(payload, "description"),
  };
}

function packageForLanguage(
  candidate: ShortCandidate,
  language: VoiceOverLanguage,
): VoiceOverPackage {
  const voiceOver = (candidate.voiceOvers ?? []).find(
    (item) => item.language === language,
  );
  if (!voiceOver) {
    throw new Error(
      `Voice-over package "${language}" not found for candidate: ${candidate.id}`,
    );
  }
  return voiceOver;
}

async function saveVoiceOverResult(
  deps: Dependencies,
  candidateId: string,
  language: VoiceOverLanguage,
  result: Partial<
    Pick<VoiceOverPackage, "youtubeVideoId" | "youtubeCaptionId">
  >,
): Promise<ShortCandidate> {
  const fresh = await deps.candidates.getById(candidateId);
  if (!fresh) throw new Error(`Candidate not found: ${candidateId}`);
  packageForLanguage(fresh, language);
  const voiceOvers = (fresh.voiceOvers ?? []).map((voiceOver) =>
    voiceOver.language === language ? { ...voiceOver, ...result } : voiceOver,
  );
  let updated: ShortCandidate = {
    ...fresh,
    voiceOvers,
    updatedAt: deps.clock.now(),
  };
  const bothCaptionsUploaded = ["it", "en"].every((requiredLanguage) =>
    voiceOvers.some(
      (voiceOver) =>
        voiceOver.language === requiredLanguage &&
        Boolean(voiceOver.youtubeCaptionId),
    ),
  );
  if (bothCaptionsUploaded && updated.status === "publishing") {
    updated = applyCandidateEvent(updated, { type: "publish_succeeded" });
  }
  await deps.candidates.save(updated);
  return updated;
}

export function createPublishVoiceOverShortHandler(
  deps: Dependencies,
): JobHandler {
  const log = deps.logger.child({ jobType: JOB_TYPE, content: "voiceOver" });

  return async (ctx) => {
    const startedAt = performance.now();
    const candidateId = requireStringPayload(ctx.payload, "candidateId");
    const payload = parsePayload(ctx.payload);
    const found = await deps.candidates.getById(candidateId);
    if (!found) throw new Error(`Candidate not found: ${candidateId}`);
    let candidate: ShortCandidate = found;
    packageForLanguage(candidate, payload.language);
    const checkpointResult = uploadResultFromCheckpoint(
      ctx.checkpoint,
      payload.language,
    );
    let accessToken: string | undefined;
    let youtubeVideoId = checkpointResult?.youtubeVideoId;

    log.info("Voice-over Short publish started", {
      jobId: ctx.jobId,
      candidateId,
      language: payload.language,
    });
    try {
      if (checkpointResult) {
        candidate = await saveVoiceOverResult(
          deps,
          candidateId,
          payload.language,
          checkpointResult,
        );
      }

      await runStep(ctx, JOB_TYPE, "prepare", async () => {
        if (candidate.status === "ready") {
          candidate = applyCandidateEvent(candidate, { type: "mark_publishing" });
          await deps.candidates.save(candidate);
        } else if (
          candidate.status !== "publishing" &&
          candidate.status !== "published"
        ) {
          throw new Error(
            `Candidate cannot publish voice-over in status "${candidate.status}"`,
          );
        }
        ctx.setProgress(5, `Preparing ${payload.language.toUpperCase()} upload`);
        accessToken = await currentYouTubeAccessToken(
          deps.auth,
          deps.clock.now(),
        );
      });

      await runStep(ctx, JOB_TYPE, "upload", async () => {
        const fresh =
          (await deps.candidates.getById(candidateId)) ?? candidate;
        const voiceOver = packageForLanguage(fresh, payload.language);
        if (voiceOver.youtubeVideoId) {
          youtubeVideoId = voiceOver.youtubeVideoId;
          ctx.setProgress(80, `Video already uploaded as ${youtubeVideoId}`);
          return;
        }
        const token =
          accessToken ??
          (await currentYouTubeAccessToken(deps.auth, deps.clock.now()));
        const settings = await deps.settings.get();
        let description = payload.description;
        if (fresh.origin === "clip" && "sourceVideoId" in fresh.provenance) {
          const source = await deps.sourceVideos.getById(
            fresh.provenance.sourceVideoId,
          );
          if (source?.youtubeVideoId) {
            description = withFullVideoLink(description, source.youtubeVideoId);
          }
        }
        ctx.setProgress(
          20,
          `Uploading ${payload.language.toUpperCase()} Short to YouTube`,
        );
        const result = await deps.upload.upload({
          accessToken: token,
          filePath: payload.filePath,
          title: payload.title,
          description,
          tags: fresh.tags,
          scheduledAt: fresh.scheduledAt,
          privacy: fresh.scheduledAt ? "private" : settings.defaultPrivacy,
          contentKind: "short",
        });
        youtubeVideoId = result.youtubeVideoId;
        await ctx.saveCheckpoint("upload", {
          language: payload.language,
          youtubeVideoId,
        } satisfies VoiceOverUploadCheckpoint);
        candidate = await saveVoiceOverResult(
          deps,
          candidateId,
          payload.language,
          { youtubeVideoId },
        );
        ctx.setProgress(85, `Uploaded video as ${youtubeVideoId}`);
      });

      await runStep(ctx, JOB_TYPE, "captions", async () => {
        if (!deps.captions) {
          throw new Error("YouTube captions adapter is not configured");
        }
        const fresh =
          (await deps.candidates.getById(candidateId)) ?? candidate;
        const voiceOver = packageForLanguage(fresh, payload.language);
        youtubeVideoId = youtubeVideoId ?? voiceOver.youtubeVideoId ?? undefined;
        if (!youtubeVideoId) {
          throw new Error(
            `YouTube video id missing for ${payload.language} voice-over`,
          );
        }
        if (voiceOver.youtubeCaptionId) {
          ctx.setProgress(100, `Caption already uploaded for ${youtubeVideoId}`);
          return;
        }
        const token =
          accessToken ??
          (await currentYouTubeAccessToken(deps.auth, deps.clock.now()));
        ctx.setProgress(
          90,
          `Uploading ${payload.language.toUpperCase()} captions`,
        );
        const caption = await deps.captions.upload({
          accessToken: token,
          youtubeVideoId,
          filePath: payload.srtPath,
          language: payload.language,
          name: "VO",
        });
        await ctx.saveCheckpoint("captions", {
          language: payload.language,
          youtubeVideoId,
          youtubeCaptionId: caption.youtubeCaptionId,
        } satisfies VoiceOverUploadCheckpoint);
        await saveVoiceOverResult(deps, candidateId, payload.language, {
          youtubeVideoId,
          youtubeCaptionId: caption.youtubeCaptionId,
        });
        ctx.setProgress(100, `Published as ${youtubeVideoId}`);
      });

      log.info("Voice-over Short publish completed", {
        jobId: ctx.jobId,
        candidateId,
        language: payload.language,
        youtubeVideoId,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      const state = isJobPausedError(error)
        ? "paused"
        : isJobCancelledError(error)
          ? "cancelled"
          : "failed";
      const context = {
        jobId: ctx.jobId,
        candidateId,
        language: payload.language,
        youtubeVideoId,
        durationMs: Math.round(performance.now() - startedAt),
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error),
      };
      state === "failed"
        ? log.error("Voice-over Short publish failed", context)
        : log.info(`Voice-over Short publish ${state}`, context);
      throw error;
    }
  };
}
