import type { ReplaySession } from "@/src/domain/entities";

export interface ReplaySessionRepository {
  save(session: ReplaySession): Promise<void>;
  getById(id: string): Promise<ReplaySession | null>;
  list(): Promise<ReplaySession[]>;
}
