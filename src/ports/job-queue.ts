import type { JobRecord } from "@/src/adapters/jobs/job-record";
import type { JobStatus } from "@/src/domain/entities";

export type JobProgressView = {
  pct: number;
  message: string;
  status: JobStatus;
  checkpointStep: string | null;
};

export type QueueMutationResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "conflict"; message: string };

export interface JobQueuePort {
  enqueue(job: {
    type: string;
    payload: Record<string, unknown>;
  }): Promise<string>;
  getProgress(jobId: string): Promise<JobProgressView | null>;
}

export interface DurableJobQueue extends JobQueuePort {
  claimNext(): Promise<JobRecord | null>;
  setProgress(jobId: string, pct: number, message: string): void;
  saveCheckpoint(jobId: string, step: string, data?: unknown): Promise<void>;
  markRunning(jobId: string): void;
  markSucceeded(jobId: string): void;
  markFailed(jobId: string, error: unknown): void;
  markPaused(jobId: string): void;
  markCancelled(jobId: string): void;
  requestPause(jobId: string): Promise<QueueMutationResult>;
  resume(jobId: string): Promise<QueueMutationResult>;
  cancel(jobId: string): Promise<"cancelled" | "aborting" | "noop">;
  isPauseRequested(jobId: string): boolean;
  clearPauseRequest(jobId: string): void;
  attachAbortController(jobId: string, controller: AbortController): void;
  getAbortSignal(jobId: string): AbortSignal | null;
  clearAbortController(jobId: string): void;
  reorder(orderedIds: string[]): Promise<void>;
  move(jobId: string, to: "top" | "bottom"): Promise<void>;
  getJob(jobId: string): JobRecord | undefined;
  listJobs(): JobRecord[];
  recoverOnBoot(): Promise<{ requeuedRunning: number }>;
}
