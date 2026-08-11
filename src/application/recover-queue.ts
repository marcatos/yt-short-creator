import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { DurableJobQueue } from "@/src/ports/job-queue";
import type { Logger } from "@/src/ports/logger";

export type RecoverQueueResult = {
  requeuedRunning: number;
  repairedCandidates: number;
};

export function createRecoverQueue(deps: {
  queue: DurableJobQueue;
  candidates: CandidateRepository;
  logger: Logger;
}): () => Promise<RecoverQueueResult> {
  const logger = deps.logger.child({ operation: "recoverQueue" });

  return async () => {
    const startedAt = Date.now();
    logger.info("Queue recovery started");

    try {
      const { requeuedRunning } = await deps.queue.recoverOnBoot();
      logger.info("Running job recovery completed", { requeuedRunning });

      const activeJobs = new Set(
        deps.queue
          .listJobs()
          .filter(
            ({ status }) =>
              status === "queued" ||
              status === "running" ||
              status === "paused",
          )
          .map(({ type, payload }) => `${type}:${String(payload.candidateId)}`),
      );
      const candidates = await deps.candidates.list({});
      let repairedCandidates = 0;

      for (const candidate of candidates) {
        if (
          candidate.status !== "rendering" &&
          candidate.status !== "publishing"
        ) {
          continue;
        }

        const type =
          candidate.status === "rendering" ? "render_short" : "publish_short";
        const activeKey = `${type}:${candidate.id}`;
        if (activeJobs.has(activeKey)) {
          continue;
        }

        await deps.queue.enqueue({
          type,
          payload: { candidateId: candidate.id },
        });
        activeJobs.add(activeKey);
        repairedCandidates += 1;
        logger.warn("Repaired orphan candidate with recovery job", {
          candidateId: candidate.id,
          status: candidate.status,
        });
      }

      logger.info("Queue recovery completed", {
        durationMs: Date.now() - startedAt,
        candidatesChecked: candidates.length,
        requeuedRunning,
        repairedCandidates,
      });
      return { requeuedRunning, repairedCandidates };
    } catch (error) {
      logger.error("Queue recovery failed", {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  };
}
