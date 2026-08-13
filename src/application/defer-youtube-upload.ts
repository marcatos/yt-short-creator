import type { JobRecord } from "@/src/adapters/jobs/job-record";
import { JobPausedError } from "@/src/domain/queue-control";
import {
  isYoutubeDailyUploadLimitCheckpoint,
  isYouTubeUploadLimitExceededError,
  youtubeDailyUploadLimitCheckpoint,
  YouTubeUploadLimitExceededError,
} from "@/src/domain/youtube-upload-limit";
import type { DurableJobQueue } from "@/src/ports/job-queue";
import type { Logger } from "@/src/ports/logger";

import type { YoutubeUploadCircuitBreaker } from "./youtube-upload-circuit-breaker";

export const PUBLISH_JOB_TYPES = new Set([
  "publish_short",
  "publish_full_replay",
]);

export function isPublishJobType(type: string): boolean {
  return PUBLISH_JOB_TYPES.has(type);
}

type DeferDeps = {
  queue: Pick<
    DurableJobQueue,
    "saveCheckpoint" | "setProgress" | "listJobs" | "getJob"
  > & {
    /** Optional: mark paused without going through runner (park siblings). */
    markPaused(jobId: string): void;
  };
  breaker: YoutubeUploadCircuitBreaker;
  logger: Logger;
};

/**
 * Arms the breaker, checkpoints the current job, and parks other queued
 * publish jobs so they do not burn failed attempts while the limit is active.
 * Caller should throw JobPausedError so the runner marks this job paused.
 */
export async function deferPublishForYoutubeDailyLimit(
  deps: DeferDeps,
  input: {
    jobId: string;
    jobType: string;
    error: YouTubeUploadLimitExceededError;
    priorAttempt?: number;
  },
): Promise<{ retryAfter: Date; attempt: number }> {
  const log = deps.logger.child({ operation: "deferPublishForYoutubeDailyLimit" });
  const existing = deps.queue.getJob(input.jobId)?.checkpoint;
  const priorFromCheckpoint =
    existing?.data && isYoutubeDailyUploadLimitCheckpoint(existing.data)
      ? existing.data.attempt
      : undefined;
  const attempt =
    input.priorAttempt ??
    (priorFromCheckpoint !== undefined ? priorFromCheckpoint + 1 : undefined) ??
    input.error.attempt ??
    deps.breaker.currentAttempt() + 1;
  const retryAfter = deps.breaker.recordLimitHit(attempt);
  const limitData = youtubeDailyUploadLimitCheckpoint(attempt, retryAfter);
  // Keep the last real pipeline step so resume does not re-run completed work.
  const step = existing?.step && existing.step.length > 0 ? existing.step : "prepare";
  const data =
    existing?.data && typeof existing.data === "object"
      ? { ...(existing.data as Record<string, unknown>), ...limitData }
      : limitData;
  await deps.queue.saveCheckpoint(input.jobId, step, data);
  deps.queue.setProgress(
    input.jobId,
    0,
    `Waiting for YouTube daily upload limit (retry after ${retryAfter.toISOString()})`,
  );

  let parked = 0;
  for (const job of deps.queue.listJobs()) {
    if (job.id === input.jobId) continue;
    if (!isPublishJobType(job.type)) continue;
    if (job.status !== "queued") continue;
    await parkQueuedPublishJob(deps, job, limitData);
    parked += 1;
  }

  log.warn("YouTube daily upload limit hit; publish deferred", {
    jobId: input.jobId,
    jobType: input.jobType,
    attempt,
    retryAfter: retryAfter.toISOString(),
    parkedQueuedPublishes: parked,
  });

  return { retryAfter, attempt };
}

async function parkQueuedPublishJob(
  deps: DeferDeps,
  job: JobRecord,
  limitData: ReturnType<typeof youtubeDailyUploadLimitCheckpoint>,
): Promise<void> {
  if (
    job.checkpoint?.data &&
    isYoutubeDailyUploadLimitCheckpoint(job.checkpoint.data)
  ) {
    return;
  }
  const step = job.checkpoint?.step?.length ? job.checkpoint.step : "prepare";
  await deps.queue.saveCheckpoint(job.id, step, limitData);
  deps.queue.setProgress(
    job.id,
    0,
    `Waiting for YouTube daily upload limit (retry after ${limitData.retryAfter})`,
  );
  deps.queue.markPaused(job.id);
}

export function throwJobPausedForUploadLimit(): never {
  throw new JobPausedError("Waiting for YouTube daily upload limit");
}

/**
 * Run a YouTube upload; on daily limit, defer the job and throw JobPausedError.
 * On success, clears the process-local circuit breaker.
 */
export async function uploadOrDeferDailyLimit<T>(
  deps: {
    queue: Partial<DeferDeps["queue"]> & Pick<DeferDeps["queue"], "listJobs">;
    breaker: YoutubeUploadCircuitBreaker;
    logger: Logger;
  },
  input: { jobId: string; jobType: string },
  upload: () => Promise<T>,
): Promise<T> {
  try {
    const result = await upload();
    deps.breaker.recordSuccess();
    return result;
  } catch (error) {
    if (!isYouTubeUploadLimitExceededError(error)) {
      throw error;
    }
    if (
      typeof deps.queue.getJob !== "function" ||
      typeof deps.queue.saveCheckpoint !== "function" ||
      typeof deps.queue.setProgress !== "function" ||
      typeof deps.queue.markPaused !== "function"
    ) {
      throw error;
    }
    await deferPublishForYoutubeDailyLimit(
      {
        queue: deps.queue as DeferDeps["queue"],
        breaker: deps.breaker,
        logger: deps.logger,
      },
      {
        jobId: input.jobId,
        jobType: input.jobType,
        error,
      },
    );
    throwJobPausedForUploadLimit();
  }
}
