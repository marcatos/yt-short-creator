import type { JobStatus } from "@/src/domain/entities";
import type { ClockPort } from "@/src/ports/clock";
import type { IdPort } from "@/src/ports/id";
import type { JobQueuePort } from "@/src/ports/job-queue";
import type { Logger } from "@/src/ports/logger";

export type JobRecord = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  progressPct: number;
  progressMessage: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

export type InProcessJobQueue = JobQueuePort & {
  claimNext(): Promise<JobRecord | null>;
  setProgress(jobId: string, pct: number, message: string): void;
  markRunning(jobId: string): void;
  markSucceeded(jobId: string): void;
  markFailed(jobId: string, error: unknown): void;
  markCancelled(jobId: string): void;
  getJob(jobId: string): JobRecord | undefined;
  listJobs(): JobRecord[];
};

type QueueDeps = {
  logger: Logger;
  idPort: IdPort;
  clock: ClockPort;
};

export function createInProcessJobQueue(deps: QueueDeps): InProcessJobQueue {
  const jobs = new Map<string, JobRecord>();
  const pending: string[] = [];
  let wake: (() => void) | null = null;

  function notifyWaiter(): void {
    wake?.();
    wake = null;
  }

  function waitForWork(): Promise<void> {
    if (pending.length > 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      wake = resolve;
    });
  }

  const queueLogger = deps.logger.child({ component: "InProcessJobQueue" });

  const queue: InProcessJobQueue = {
    async enqueue(job) {
      const id = deps.idPort.generate();
      const record: JobRecord = {
        id,
        type: job.type,
        payload: job.payload,
        status: "queued",
        progressPct: 0,
        progressMessage: "",
        createdAt: deps.clock.now(),
        startedAt: null,
        finishedAt: null,
      };
      jobs.set(id, record);
      pending.push(id);
      queueLogger.info("Job enqueued", { jobId: id, type: job.type });
      notifyWaiter();
      return id;
    },

    async getProgress(jobId) {
      const job = jobs.get(jobId);
      if (!job) {
        return null;
      }
      return { pct: job.progressPct, message: job.progressMessage };
    },

    async claimNext() {
      while (pending.length === 0) {
        await waitForWork();
      }
      const jobId = pending.shift();
      if (!jobId) {
        return null;
      }
      return jobs.get(jobId) ?? null;
    },

    setProgress(jobId, pct, message) {
      const job = jobs.get(jobId);
      if (!job) {
        return;
      }
      job.progressPct = pct;
      job.progressMessage = message;
    },

    markRunning(jobId) {
      const job = jobs.get(jobId);
      if (!job) {
        return;
      }
      job.status = "running";
      job.startedAt = deps.clock.now();
    },

    markSucceeded(jobId) {
      const job = jobs.get(jobId);
      if (!job) {
        return;
      }
      job.status = "succeeded";
      job.finishedAt = deps.clock.now();
    },

    markFailed(jobId, error) {
      const job = jobs.get(jobId);
      if (!job) {
        return;
      }
      job.status = "failed";
      job.finishedAt = deps.clock.now();
      queueLogger.error("Job failed", {
        jobId,
        type: job.type,
        error: error instanceof Error ? error.message : String(error),
      });
    },

    markCancelled(jobId) {
      const job = jobs.get(jobId);
      if (!job) {
        return;
      }
      job.status = "cancelled";
      job.finishedAt = deps.clock.now();
    },

    getJob(jobId) {
      return jobs.get(jobId);
    },

    listJobs() {
      return Array.from(jobs.values()).reverse();
    },
  };

  return queue;
}
