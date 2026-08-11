import type { ShortCandidate } from "@/src/domain/entities";
import type { CandidateRepository } from "@/src/ports/candidate-repository";

export type ListCandidates = (filter?: {
  status?: string;
  origin?: string;
}) => Promise<ShortCandidate[]>;

export function createListCandidates(deps: {
  candidates: CandidateRepository;
}): ListCandidates {
  return (filter = {}) => deps.candidates.list(filter);
}
