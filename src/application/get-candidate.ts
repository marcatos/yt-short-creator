import type { ShortCandidate } from "@/src/domain/entities";
import type { CandidateRepository } from "@/src/ports/candidate-repository";

export type GetCandidate = (input: {
  candidateId: string;
}) => Promise<ShortCandidate>;

export function createGetCandidate(deps: {
  candidates: CandidateRepository;
}): GetCandidate {
  return async ({ candidateId }) => {
    const candidate = await deps.candidates.getById(candidateId);
    if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
    return candidate;
  };
}
