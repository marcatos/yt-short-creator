import type { Channel } from "@/src/domain/entities";
import type { InspectableJobQueue } from "@/src/ports/job-queue";
import type { InstagramAuthPort } from "@/src/ports/instagram-auth";
import type { Logger } from "@/src/ports/logger";
import { isInstagramConnected } from "@/src/workers/instagram-access-token";

type Dependencies = {
  queue: InspectableJobQueue;
  instagramAuth: InstagramAuthPort;
  logger: Logger;
};

const ACTIVE_STATUSES = new Set(["queued", "running", "paused", "succeeded"]);

export function createEnqueueInstagramReel(deps: Dependencies) {
  const log = deps.logger.child({ operation: "enqueueInstagramReel" });

  return async (candidateId: string): Promise<string | null> => {
    if (!(await isInstagramConnected(deps.instagramAuth))) {
      return null;
    }

    const existing = deps.queue.listJobs().find(
      (job) =>
        job.type === "publish_reel" &&
        job.payload.candidateId === candidateId &&
        ACTIVE_STATUSES.has(job.status),
    );
    if (existing) {
      log.info("publish_reel enqueue skipped", {
        candidateId,
        existingJobId: existing.id,
        existingJobStatus: existing.status,
      });
      return existing.id;
    }

    const jobId = await deps.queue.enqueue({
      type: "publish_reel",
      payload: { candidateId },
    });
    log.info("publish_reel enqueued", { candidateId, jobId });
    return jobId;
  };
}

export function resolveYoutubeChannelUrl(
  channel: Channel | null,
  override?: string,
): string {
  const trimmed = override?.trim();
  if (trimmed) return trimmed;
  if (channel) {
    return `https://www.youtube.com/channel/${channel.youtubeChannelId}`;
  }
  return "https://www.youtube.com";
}
