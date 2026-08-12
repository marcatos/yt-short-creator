import type { JobCheckpoint } from "@/src/domain/queue-control";
import type {
  VoiceOverLanguage,
  VoiceOverPackage,
} from "@/src/domain/voice-over";
import type { Logger } from "@/src/ports/logger";
import type { MediaStorePort } from "@/src/ports/media-store";

export type VoiceOverUploadCheckpoint = {
  language: VoiceOverLanguage;
  youtubeVideoId: string;
  youtubeCaptionId?: string;
};

function fromJobCheckpoint(
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

function merge(
  preferred: VoiceOverUploadCheckpoint | null,
  fallback: VoiceOverUploadCheckpoint | null,
): VoiceOverUploadCheckpoint | null {
  if (!preferred) return fallback;
  if (!fallback || preferred.youtubeVideoId !== fallback.youtubeVideoId) {
    return preferred;
  }
  return {
    ...fallback,
    ...preferred,
    youtubeCaptionId:
      preferred.youtubeCaptionId ?? fallback.youtubeCaptionId,
  };
}

export function resolveVoiceOverUploadCheckpoint(
  voiceOver: VoiceOverPackage,
  sidecar: VoiceOverUploadCheckpoint | null,
  jobCheckpoint: JobCheckpoint | null,
): VoiceOverUploadCheckpoint | null {
  const packageCheckpoint = voiceOver.youtubeVideoId
    ? {
        language: voiceOver.language,
        youtubeVideoId: voiceOver.youtubeVideoId,
        ...(voiceOver.youtubeCaptionId
          ? { youtubeCaptionId: voiceOver.youtubeCaptionId }
          : {}),
      }
    : null;
  return merge(
    merge(packageCheckpoint, sidecar),
    fromJobCheckpoint(jobCheckpoint, voiceOver.language),
  );
}

export function createVoiceOverPublishSidecar(deps: {
  candidateId: string;
  language: VoiceOverLanguage;
  mediaStore?: MediaStorePort;
  logger: Logger;
}): {
  load(): Promise<VoiceOverUploadCheckpoint | null>;
  save(result: VoiceOverUploadCheckpoint): Promise<void>;
} {
  const sidecarPath = deps.mediaStore?.voPublishCheckpointPath?.(
    deps.candidateId,
    deps.language,
  );
  const logContext = {
    candidateId: deps.candidateId,
    language: deps.language,
    sidecarPath,
  };

  return {
    async load() {
      if (!sidecarPath || !deps.mediaStore?.readText) return null;
      try {
        const content = await deps.mediaStore.readText(sidecarPath);
        if (!content) return null;
        const parsed = fromJobCheckpoint(
          {
            step: "captions",
            data: JSON.parse(content) as Record<string, unknown>,
          },
          deps.language,
        );
        if (!parsed) {
          deps.logger.warn("Ignored invalid voice-over publish sidecar", logContext);
        }
        return parsed;
      } catch (error) {
        deps.logger.warn("Failed to read voice-over publish sidecar", {
          ...logContext,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    async save(result) {
      if (!sidecarPath || !deps.mediaStore?.writeText) return;
      try {
        await deps.mediaStore.writeText(sidecarPath, JSON.stringify(result));
      } catch (error) {
        deps.logger.warn("Failed to persist voice-over publish sidecar", {
          ...logContext,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
