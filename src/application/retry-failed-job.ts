import { applyCandidateEvent } from "@/src/domain/approval";
import type { ShortCandidate } from "@/src/domain/entities";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { JobQueuePort } from "@/src/ports/job-queue";
import type { Logger } from "@/src/ports/logger";

type Dependencies = {
  candidates: CandidateRepository;
  queue: JobQueuePort;
  logger: Logger;
};

export type RetryFailedJob = (input: {
  candidateId: string;
}) => Promise<ShortCandidate>;

export function createRetryFailedJob(deps: Dependencies): RetryFailedJob {
  const log = deps.logger.child({ operation: "retryFailedJob" });
  return async ({ candidateId }) => {
    const startedAt = performance.now();
    log.info("Failed candidate retry started", { candidateId });
    try {
      const candidate = await deps.candidates.getById(candidateId);
      if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
      const retryUpload = candidate.renderOutputPath !== null;
      const retried = applyCandidateEvent(candidate, {
        type: retryUpload ? "retry_upload" : "retry_render",
      });
      await deps.candidates.save(retried);
      const jobId = await deps.queue.enqueue({
        type: retryUpload ? "publish_short" : "render_short",
        payload: { candidateId },
      });
      log.info("Failed candidate retry enqueued", {
        candidateId,
        jobId,
        jobType: retryUpload ? "publish_short" : "render_short",
        durationMs: Math.round(performance.now() - startedAt),
      });
      return retried;
    } catch (error) {
      log.error("Failed candidate retry failed", {
        candidateId,
        durationMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      });
      throw error;
    }
  };
}
