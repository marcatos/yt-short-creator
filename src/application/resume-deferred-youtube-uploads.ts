import {
  isYoutubeDailyUploadLimitCheckpoint,
  YOUTUBE_DAILY_UPLOAD_LIMIT_REASON,
} from "@/src/domain/youtube-upload-limit";
import type { DurableJobQueue } from "@/src/ports/job-queue";
import type { Logger } from "@/src/ports/logger";

import { isPublishJobType } from "./defer-youtube-upload";
import type { YoutubeUploadCircuitBreaker } from "./youtube-upload-circuit-breaker";

type Deps = {
  queue: Pick<DurableJobQueue, "listJobs" | "resume">;
  breaker: YoutubeUploadCircuitBreaker;
  logger: Logger;
  now?: () => Date;
};

/**
 * Resume publish jobs paused for the daily upload limit once retryAfter has passed.
 * Also re-arms the in-memory breaker from durable checkpoints after restarts.
 */
export async function resumeDeferredYoutubeUploads(deps: Deps): Promise<{
  resumed: number;
}> {
  const log = deps.logger.child({ operation: "resumeDeferredYoutubeUploads" });
  const now = deps.now?.() ?? new Date();

  for (const job of deps.queue.listJobs()) {
    if (!isPublishJobType(job.type)) continue;
    if (job.status !== "paused" && job.status !== "queued") continue;
    const data = job.checkpoint?.data;
    if (!isYoutubeDailyUploadLimitCheckpoint(data)) continue;
    deps.breaker.restoreBlockedUntil(new Date(data.retryAfter), data.attempt, now);
  }

  let resumed = 0;
  for (const job of deps.queue.listJobs()) {
    if (job.status !== "paused") continue;
    if (!isPublishJobType(job.type)) continue;
    const data = job.checkpoint?.data;
    if (!isYoutubeDailyUploadLimitCheckpoint(data)) continue;
    if (new Date(data.retryAfter).getTime() > now.getTime()) continue;
    const result = await deps.queue.resume(job.id);
    if (result.ok) {
      resumed += 1;
      log.info("Resumed publish after YouTube daily upload limit wait", {
        jobId: job.id,
        type: job.type,
        attempt: data.attempt,
        reason: YOUTUBE_DAILY_UPLOAD_LIMIT_REASON,
      });
    }
  }
  if (resumed > 0) {
    log.info("Deferred YouTube uploads resumed", { resumed });
  }
  return { resumed };
}
