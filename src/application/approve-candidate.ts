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

export type ApproveCandidate = (input: {
  candidateId: string;
}) => Promise<ShortCandidate>;

export function createApproveCandidate(deps: Dependencies): ApproveCandidate {
  const log = deps.logger.child({ operation: "approveCandidate" });
  return async ({ candidateId }) => {
    const startedAt = performance.now();
    log.info("Candidate approval started", { candidateId });
    try {
      const candidate = await deps.candidates.getById(candidateId);
      if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
      const approved = applyCandidateEvent(candidate, { type: "approve" });
      await deps.candidates.save(approved);
      const renderJobId = await deps.queue.enqueue({
        type: "render_short",
        payload: { candidateId },
      });
      log.info("Candidate approved and render enqueued", {
        candidateId,
        renderJobId,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return approved;
    } catch (error) {
      log.error("Candidate approval failed", {
        candidateId,
        durationMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      });
      throw error;
    }
  };
}
