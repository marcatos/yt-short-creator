import type { JobRecord } from "@/src/adapters/jobs/job-record";
import {
  applyOrder,
  createQueuedJobRecord,
  findNextQueued,
  hasQueuedJob,
  type InProcessQueueDeps,
  movedOrder,
  nextPosition,
  recoverRunningJobs,
} from "@/src/adapters/jobs/in-process-queue-helpers";
import type { DurableJobQueue } from "@/src/ports/job-queue";

export type { JobRecord } from "@/src/adapters/jobs/job-record";
export type InProcessJobQueue = DurableJobQueue;

export function createInProcessJobQueue(deps: InProcessQueueDeps): InProcessJobQueue {
  const jobs = new Map<string, JobRecord>();
  const pauseRequests = new Set<string>();
  const abortControllers = new Map<string, AbortController>();
  let wake: (() => void) | null = null;

  function notifyWaiter(): void {
    wake?.();
    wake = null;
  }

  function waitForWork(): Promise<void> {
    if (hasQueuedJob(jobs)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      wake = resolve;
    });
  }

  function touch(job: JobRecord): void {
    job.updatedAt = deps.clock.now();
  }

  const queueLogger = deps.logger.child({ component: "InProcessJobQueue" });
  const queue: InProcessJobQueue = {
    async enqueue(job) {
      const id = deps.idPort.generate();
      const now = deps.clock.now();
      const position = nextPosition(jobs);
      const record = createQueuedJobRecord(job, id, position, now);
      jobs.set(id, record);
      queueLogger.info("Job enqueued", {
        jobId: id,
        type: job.type,
        position,
      });
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
      let next = findNextQueued(jobs);
      while (!next) {
        await waitForWork();
        next = findNextQueued(jobs);
      }
      queueLogger.info("Job claimed", {
        jobId: next.id,
        type: next.type,
        position: next.position,
      });
      return next;
    },

    setProgress(jobId, pct, message) {
      const job = jobs.get(jobId);
      if (!job) {
        return;
      }
      job.progressPct = pct;
      job.progressMessage = message;
      touch(job);
      queueLogger.debug("Job progress updated", {
        jobId,
        type: job.type,
        pct,
      });
    },

    async saveCheckpoint(jobId, step, data) {
      const job = jobs.get(jobId);
      if (!job) {
        return;
      }
      job.checkpoint = data === undefined ? { step } : { step, data };
      touch(job);
      queueLogger.debug("Job checkpoint saved", { jobId, step });
    },

    markRunning(jobId) {
      const job = jobs.get(jobId);
      if (!job) {
        return;
      }
      job.status = "running";
      job.startedAt = deps.clock.now();
      touch(job);
    },

    markSucceeded(jobId) {
      const job = jobs.get(jobId);
      if (!job) {
        return;
      }
      job.status = "succeeded";
      job.finishedAt = deps.clock.now();
      pauseRequests.delete(jobId);
      abortControllers.delete(jobId);
      touch(job);
    },

    markFailed(jobId, error) {
      const job = jobs.get(jobId);
      if (!job) {
        return;
      }
      job.status = "failed";
      job.finishedAt = deps.clock.now();
      job.error = error instanceof Error ? error.message : String(error);
      pauseRequests.delete(jobId);
      abortControllers.delete(jobId);
      touch(job);
      queueLogger.error("Job failed", {
        jobId,
        type: job.type,
        error: job.error,
      });
    },

    markPaused(jobId) {
      const job = jobs.get(jobId);
      if (!job) {
        return;
      }
      job.status = "paused";
      pauseRequests.delete(jobId);
      abortControllers.delete(jobId);
      touch(job);
      queueLogger.info("Job paused", { jobId });
    },

    markCancelled(jobId) {
      const job = jobs.get(jobId);
      if (!job) {
        return;
      }
      job.status = "cancelled";
      job.finishedAt = deps.clock.now();
      pauseRequests.delete(jobId);
      abortControllers.delete(jobId);
      touch(job);
      queueLogger.info("Job cancelled", { jobId });
    },

    async requestPause(jobId) {
      const job = jobs.get(jobId);
      if (!job) {
        return { ok: false, code: "not_found", message: "Job not found" };
      }
      if (job.status !== "running") {
        return {
          ok: false,
          code: "conflict",
          message: "Only running jobs can be paused",
        };
      }
      pauseRequests.add(jobId);
      touch(job);
      queueLogger.info("Job pause requested", { jobId });
      return { ok: true };
    },

    async resume(jobId) {
      const job = jobs.get(jobId);
      if (!job) {
        return { ok: false, code: "not_found", message: "Job not found" };
      }
      if (job.status !== "paused") {
        return {
          ok: false,
          code: "conflict",
          message: "Only paused jobs can be resumed",
        };
      }
      job.status = "queued";
      pauseRequests.delete(jobId);
      abortControllers.delete(jobId);
      touch(job);
      queueLogger.info("Job resumed", { jobId });
      notifyWaiter();
      return { ok: true };
    },

    async cancel(jobId) {
      const job = jobs.get(jobId);
      if (!job) {
        return "noop";
      }
      if (job.status === "queued" || job.status === "paused") {
        queue.markCancelled(jobId);
        return "cancelled";
      }
      if (job.status === "running") {
        abortControllers.get(jobId)?.abort();
        touch(job);
        queueLogger.info("Running job cancellation requested", { jobId });
        return "aborting";
      }
      return "noop";
    },

    isPauseRequested(jobId) {
      return pauseRequests.has(jobId);
    },

    clearPauseRequest(jobId) {
      pauseRequests.delete(jobId);
      const job = jobs.get(jobId);
      if (job) {
        touch(job);
      }
    },

    attachAbortController(jobId, controller) {
      abortControllers.set(jobId, controller);
      const job = jobs.get(jobId);
      if (job) {
        touch(job);
      }
    },

    getAbortSignal(jobId) {
      return abortControllers.get(jobId)?.signal ?? null;
    },

    clearAbortController(jobId) {
      abortControllers.delete(jobId);
      const job = jobs.get(jobId);
      if (job) {
        touch(job);
      }
    },

    async reorder(orderedIds) {
      applyOrder(jobs, orderedIds, touch);
      queueLogger.info("Jobs reordered", { jobCount: orderedIds.length });
      notifyWaiter();
    },

    async move(jobId, to) {
      const job = jobs.get(jobId);
      await queue.reorder(movedOrder(jobs, jobId, to));
      queueLogger.info("Job moved", { jobId, type: job?.type, to });
    },

    getJob(jobId) {
      return jobs.get(jobId);
    },

    listJobs() {
      return Array.from(jobs.values()).reverse();
    },

    clearTerminalJobs() {
      let cleared = 0;
      for (const [id, job] of jobs) {
        if (
          job.status === "succeeded" ||
          job.status === "failed" ||
          job.status === "cancelled"
        ) {
          jobs.delete(id);
          cleared += 1;
        }
      }
      queueLogger.info("Terminal jobs cleared", { cleared });
      return cleared;
    },

    async recoverOnBoot() {
      const requeuedRunning = recoverRunningJobs(
        jobs,
        pauseRequests,
        abortControllers,
        touch,
      );
      if (requeuedRunning > 0) {
        queueLogger.info("Running jobs recovered", { requeuedRunning });
        notifyWaiter();
      }
      return { requeuedRunning };
    },
  };
  return queue;
}
