import { applyCandidateEvent } from "@/src/domain/approval";
import type { ShortCandidate } from "@/src/domain/entities";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { Logger } from "@/src/ports/logger";

type Dependencies = {
  candidates: CandidateRepository;
  logger: Logger;
};

export type RejectCandidate = (input: {
  candidateId: string;
}) => Promise<ShortCandidate>;

export function createRejectCandidate(deps: Dependencies): RejectCandidate {
  const log = deps.logger.child({ operation: "rejectCandidate" });
  return async ({ candidateId }) => {
    const startedAt = performance.now();
    log.info("Candidate rejection started", { candidateId });
    try {
      const candidate = await deps.candidates.getById(candidateId);
      if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
      const rejected = applyCandidateEvent(candidate, { type: "reject" });
      await deps.candidates.save(rejected);
      log.info("Candidate rejected", {
        candidateId,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return rejected;
    } catch (error) {
      log.error("Candidate rejection failed", {
        candidateId,
        durationMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      });
      throw error;
    }
  };
}
