import path from "node:path";

import type { JobCheckpoint } from "@/src/domain/queue-control";
import type {
  VoiceOverLanguage,
  VoiceOverPackage,
} from "@/src/domain/voice-over";
import type { Logger } from "@/src/ports/logger";
import type { MediaStorePort } from "@/src/ports/media-store";

export type VoiceOverUploadCheckpoint = {
  language: VoiceOverLanguage;
  scriptHash: string;
  renderOutputBasename?: string;
  youtubeVideoId: string;
  youtubeCaptionId?: string;
};

function parseVoiceOverUploadCheckpoint(
  value: unknown,
): VoiceOverUploadCheckpoint | null {
  if (typeof value !== "object" || value === null) return null;
  const data = value as Record<string, unknown>;
  if (
    (data.language !== "it" && data.language !== "en") ||
    typeof data.scriptHash !== "string" ||
    data.scriptHash.length === 0 ||
    typeof data.youtubeVideoId !== "string" ||
    data.youtubeVideoId.length === 0
  ) {
    return null;
  }
  return {
    language: data.language,
    scriptHash: data.scriptHash,
    ...(typeof data.renderOutputBasename === "string"
      ? { renderOutputBasename: data.renderOutputBasename }
      : {}),
    youtubeVideoId: data.youtubeVideoId,
    ...(typeof data.youtubeCaptionId === "string" &&
    data.youtubeCaptionId.length > 0
      ? { youtubeCaptionId: data.youtubeCaptionId }
      : {}),
  };
}

/** Language-suffixed variants ("upload_it") come from the full-race handler. */
function isUploadResultStep(step: string | undefined): boolean {
  return Boolean(
    step && (step.startsWith("upload") || step.startsWith("captions")),
  );
}

function fromJobCheckpoint(
  checkpoint: JobCheckpoint | null,
  voiceOver: VoiceOverPackage,
): VoiceOverUploadCheckpoint | null {
  if (!isUploadResultStep(checkpoint?.step)) return null;
  const data = parseVoiceOverUploadCheckpoint(checkpoint?.data);
  if (
    !data ||
    data.language !== voiceOver.language ||
    data.scriptHash !== voiceOver.scriptHash
  ) {
    return null;
  }
  return data;
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
  priorJobCheckpoints: JobCheckpoint[] = [],
): VoiceOverUploadCheckpoint | null {
  const packageCheckpoint = voiceOver.youtubeVideoId
    ? {
        language: voiceOver.language,
        scriptHash: voiceOver.scriptHash,
        ...(voiceOver.renderOutputPath
          ? { renderOutputBasename: path.basename(voiceOver.renderOutputPath) }
          : {}),
        youtubeVideoId: voiceOver.youtubeVideoId,
        ...(voiceOver.youtubeCaptionId
          ? { youtubeCaptionId: voiceOver.youtubeCaptionId }
          : {}),
      }
    : null;
  const current = merge(
    merge(packageCheckpoint, sidecar),
    fromJobCheckpoint(jobCheckpoint, voiceOver),
  );
  // Operator cleared package YT id + sidecar (intentional re-render/re-upload).
  // Do not resurrect uploads from older publish_short jobs with the same scriptHash.
  if (!packageCheckpoint && !sidecar) {
    const fromCurrent = fromJobCheckpoint(jobCheckpoint, voiceOver);
    return priorJobCheckpoints.reduce(
      (result, checkpoint) =>
        merge(result, fromJobCheckpoint(checkpoint, voiceOver)),
      fromCurrent,
    );
  }
  return priorJobCheckpoints.reduce(
    (result, checkpoint) =>
      merge(result, fromJobCheckpoint(checkpoint, voiceOver)),
    current,
  );
}

type InspectedJob = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  checkpoint: JobCheckpoint | null;
};

function priorCheckpoints(
  jobs: InspectedJob[],
  currentJobId: string,
  matches: (job: InspectedJob) => boolean,
): JobCheckpoint[] {
  return jobs
    .filter((job) => job.id !== currentJobId && matches(job))
    .map((job) => job.checkpoint)
    .filter((checkpoint): checkpoint is JobCheckpoint => checkpoint !== null);
}

export function priorVoiceOverJobCheckpoints(input: {
  jobs: InspectedJob[];
  currentJobId: string;
  candidateId: string;
  language: VoiceOverLanguage;
}): JobCheckpoint[] {
  return priorCheckpoints(
    input.jobs,
    input.currentJobId,
    (job) =>
      job.type === "publish_short" &&
      job.payload.candidateId === input.candidateId &&
      job.payload.language === input.language,
  );
}

/**
 * Checkpoints left by earlier `publish_full_replay` jobs for the same session.
 * A single job publishes both languages, so language matching happens on the
 * checkpoint payload rather than the job payload.
 */
export function priorFullVoiceOverJobCheckpoints(input: {
  jobs: InspectedJob[];
  currentJobId: string;
  sessionId: string;
}): JobCheckpoint[] {
  return priorCheckpoints(
    input.jobs,
    input.currentJobId,
    (job) =>
      job.type === "publish_full_replay" &&
      job.payload.sessionId === input.sessionId,
  );
}

export function uploadCheckpointFromJob(
  checkpoint: JobCheckpoint | null,
  language: VoiceOverLanguage,
): VoiceOverUploadCheckpoint | null {
  if (!isUploadResultStep(checkpoint?.step)) return null;
  const parsed = parseVoiceOverUploadCheckpoint(checkpoint?.data);
  return parsed?.language === language ? parsed : null;
}

export async function loadVoiceOverPublishSidecar(deps: {
  ownerId: string;
  language: VoiceOverLanguage;
  sidecarPath?: string;
  mediaStore?: MediaStorePort;
  logger: Logger;
}): Promise<VoiceOverUploadCheckpoint | null> {
  if (!deps.sidecarPath || !deps.mediaStore?.readText) return null;
  const logContext = {
    ownerId: deps.ownerId,
    language: deps.language,
    sidecarPath: deps.sidecarPath,
  };
  try {
    const content = await deps.mediaStore.readText(deps.sidecarPath);
    if (!content) return null;
    const parsed = parseVoiceOverUploadCheckpoint(JSON.parse(content));
    if (!parsed || parsed.language !== deps.language) {
      deps.logger.warn("Ignored invalid voice-over publish sidecar", logContext);
      return null;
    }
    return parsed;
  } catch (error) {
    deps.logger.warn("Failed to read voice-over publish sidecar", {
      ...logContext,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Publish results survive a job (or its DB row) disappearing by also living in
 * a media-store file keyed by owner + language, versioned by script hash.
 */
export function createVoiceOverPublishSidecar(deps: {
  /** Candidate id for Shorts, session id for full races. */
  ownerId: string;
  voiceOver: VoiceOverPackage;
  sidecarPath?: string;
  mediaStore?: MediaStorePort;
  logger: Logger;
}): {
  load(): Promise<VoiceOverUploadCheckpoint | null>;
  save(result: VoiceOverUploadCheckpoint): Promise<void>;
} {
  const sidecarPath = deps.sidecarPath;
  const logContext = {
    ownerId: deps.ownerId,
    language: deps.voiceOver.language,
    scriptHash: deps.voiceOver.scriptHash,
    sidecarPath,
  };

  return {
    async load() {
      const parsed = await loadVoiceOverPublishSidecar({
        ownerId: deps.ownerId,
        language: deps.voiceOver.language,
        sidecarPath,
        mediaStore: deps.mediaStore,
        logger: deps.logger,
      });
      if (!parsed || parsed.scriptHash !== deps.voiceOver.scriptHash) {
        if (parsed) {
          deps.logger.warn("Ignored invalid voice-over publish sidecar", logContext);
        }
        return null;
      }
      return parsed;
    },
    async save(result) {
      if (!sidecarPath || !deps.mediaStore?.writeText) return;
      try {
        await deps.mediaStore.writeText(sidecarPath, JSON.stringify(result));
      } catch (error) {
        deps.logger.error("Failed to persist voice-over publish sidecar", {
          ...logContext,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      }
    },
  };
}
