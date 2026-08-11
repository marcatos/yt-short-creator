import type { ShortCandidate } from "@/src/domain/entities";

export interface CandidateRepository {
  save(candidate: ShortCandidate): Promise<void>;
  getById(id: string): Promise<ShortCandidate | null>;
  list(filter: {
    status?: string;
    origin?: string;
  }): Promise<ShortCandidate[]>;
}
