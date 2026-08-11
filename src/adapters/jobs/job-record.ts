import type { JobStatus } from "@/src/domain/entities";
import type { JobCheckpoint } from "@/src/domain/queue-control";

export type JobRecord = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  position: number;
  progressPct: number;
  progressMessage: string;
  checkpoint: JobCheckpoint | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  updatedAt: Date;
};
