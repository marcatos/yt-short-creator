import type { YoutubePrivacy } from "@/src/domain/entities";
import type { InspectableJobQueue } from "@/src/ports/job-queue";
import type { Logger } from "@/src/ports/logger";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";

type Dependencies = {
  replaySessions: ReplaySessionRepository;
  queue: InspectableJobQueue;
  logger: Logger;
};

export type RequestFullReplayPublish = (input: {
  sessionId: string;
  privacy?: YoutubePrivacy;
}) => Promise<{ jobId: string }>;

export function createRequestFullReplayPublish(
  deps: Dependencies,
): RequestFullReplayPublish {
  const log = deps.logger.child({ operation: "requestFullReplayPublish" });

  return async ({ sessionId, privacy = "unlisted" }) => {
    const startedAt = performance.now();
    const session = await deps.replaySessions.getById(sessionId);
    if (!session) {
      throw new Error(`Replay session not found: ${sessionId}`);
    }
    if (!session.mediaPath) {
      throw new Error("Replay session has no source media to encode/upload");
    }
    if (!session.racePackage?.fullVideo?.title) {
      throw new Error(
        "Run AV analysis first so title/description for the full video exist",
      );
    }

    const existing = deps.queue.listJobs().find(
      (job) =>
        job.type === "publish_full_replay" &&
        job.payload.sessionId === sessionId &&
        ["queued", "running", "paused"].includes(job.status),
    );
    if (existing) {
      log.info("Full replay publish already queued", {
        sessionId,
        jobId: existing.id,
      });
      return { jobId: existing.id };
    }

    const jobId = await deps.queue.enqueue({
      type: "publish_full_replay",
      payload: { sessionId, privacy },
    });
    log.info("Full replay publish enqueued", {
      sessionId,
      jobId,
      privacy,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return { jobId };
  };
}
