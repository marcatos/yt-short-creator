import { applyCandidateEvent } from "@/src/domain/approval";
import type { ShortCandidate } from "@/src/domain/entities";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { Logger } from "@/src/ports/logger";

type Dependencies = {
  candidates: CandidateRepository;
  logger: Logger;
};

export type RequestRevision = (input: {
  candidateId: string;
}) => Promise<ShortCandidate>;

export function createRequestRevision(deps: Dependencies): RequestRevision {
  const log = deps.logger.child({ operation: "requestRevision" });
  return async ({ candidateId }) => {
    const startedAt = performance.now();
    log.info("Candidate revision requested", { candidateId });
    try {
      const candidate = await deps.candidates.getById(candidateId);
      if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
      const revising = applyCandidateEvent(candidate, {
        type: "request_revision",
      });
      await deps.candidates.save(revising);
      log.info("Candidate moved to revision", {
        candidateId,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return revising;
    } catch (error) {
      log.error("Candidate revision request failed", {
        candidateId,
        durationMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      });
      throw error;
    }
  };
}
