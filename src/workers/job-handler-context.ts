import type { JobCheckpoint } from "@/src/domain/queue-control";

export type JobHandlerContext = {
  jobId: string;
  payload: Record<string, unknown>;
  checkpoint: JobCheckpoint | null;
  setProgress(pct: number, message: string): void;
  saveCheckpoint(step: string, data?: unknown): Promise<void>;
  signal: AbortSignal;
  shouldPause(): boolean;
  throwIfPausedOrCancelled(): void;
};

export type JobHandler = (ctx: JobHandlerContext) => Promise<void>;

export type JobHandlers = Record<string, JobHandler>;
