import type { JobRecord } from "@/src/adapters/jobs/job-record";
import type { ClockPort } from "@/src/ports/clock";
import type { IdPort } from "@/src/ports/id";
import type { DurableJobQueue } from "@/src/ports/job-queue";
import type { Logger } from "@/src/ports/logger";

export type { JobRecord } from "@/src/adapters/jobs/job-record";

export type InProcessJobQueue = DurableJobQueue;

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
      const now = deps.clock.now();
      const record: JobRecord = {
        id,
        type: job.type,
        payload: job.payload,
        status: "queued",
        position: 0,
        progressPct: 0,
        progressMessage: "",
        checkpoint: null,
        error: null,
        createdAt: now,
        startedAt: null,
        finishedAt: null,
        updatedAt: now,
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
      return {
        pct: job.progressPct,
        message: job.progressMessage,
        status: job.status,
        checkpointStep: job.checkpoint?.step ?? null,
      };
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

    async saveCheckpoint() {
      throw new Error("Not implemented");
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

    markPaused() {
      throw new Error("Not implemented");
    },

    markCancelled(jobId) {
      const job = jobs.get(jobId);
      if (!job) {
        return;
      }
      job.status = "cancelled";
      job.finishedAt = deps.clock.now();
    },

    async requestPause() {
      throw new Error("Not implemented");
    },

    async resume() {
      throw new Error("Not implemented");
    },

    async cancel() {
      throw new Error("Not implemented");
    },

    isPauseRequested() {
      throw new Error("Not implemented");
    },

    clearPauseRequest() {
      throw new Error("Not implemented");
    },

    attachAbortController() {
      throw new Error("Not implemented");
    },

    getAbortSignal() {
      throw new Error("Not implemented");
    },

    clearAbortController() {
      throw new Error("Not implemented");
    },

    async reorder() {
      throw new Error("Not implemented");
    },

    async move() {
      throw new Error("Not implemented");
    },

    getJob(jobId) {
      return jobs.get(jobId);
    },

    listJobs() {
      return Array.from(jobs.values()).reverse();
    },

    async recoverOnBoot() {
      throw new Error("Not implemented");
    },
  };

  return queue;
}
