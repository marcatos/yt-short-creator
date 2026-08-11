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
  const pauseRequests = new Set<string>();
  const abortControllers = new Map<string, AbortController>();
  let wake: (() => void) | null = null;

  function hasQueuedJob(): boolean {
    return Array.from(jobs.values()).some((job) => job.status === "queued");
  }

  function notifyWaiter(): void {
    wake?.();
    wake = null;
  }

  function waitForWork(): Promise<void> {
    if (hasQueuedJob()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      wake = resolve;
    });
  }

  function touch(job: JobRecord): void {
    job.updatedAt = deps.clock.now();
  }

  function findNextQueued(): JobRecord | null {
    let next: JobRecord | null = null;
    for (const job of jobs.values()) {
      if (
        job.status === "queued" &&
        (!next || job.position < next.position)
      ) {
        next = job;
      }
    }
    return next;
  }

  function orderedControllableJobs(): JobRecord[] {
    return Array.from(jobs.values())
      .filter((job) => job.status === "queued" || job.status === "paused")
      .sort((left, right) => left.position - right.position);
  }

  const queueLogger = deps.logger.child({ component: "InProcessJobQueue" });

  const queue: InProcessJobQueue = {
    async enqueue(job) {
      const id = deps.idPort.generate();
      const now = deps.clock.now();
      const position =
        Array.from(jobs.values()).reduce(
          (max, existing) => Math.max(max, existing.position),
          -1,
        ) + 1;
      const record: JobRecord = {
        id,
        type: job.type,
        payload: job.payload,
        status: "queued",
        position,
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
      let next = findNextQueued();
      while (!next) {
        await waitForWork();
        next = findNextQueued();
      }
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
      const controllableJobs = orderedControllableJobs();
      const expectedIds = new Set(controllableJobs.map((job) => job.id));
      const suppliedIds = new Set(orderedIds);
      if (
        suppliedIds.size !== orderedIds.length ||
        suppliedIds.size !== expectedIds.size ||
        orderedIds.some((id) => !expectedIds.has(id))
      ) {
        throw new Error(
          "orderedIds must exactly match the current queued and paused jobs",
        );
      }
      orderedIds.forEach((id, position) => {
        const job = jobs.get(id);
        if (job) {
          job.position = position;
          touch(job);
        }
      });
      queueLogger.info("Jobs reordered", { jobCount: orderedIds.length });
      notifyWaiter();
    },

    async move(jobId, to) {
      const orderedIds = orderedControllableJobs().map((job) => job.id);
      const currentIndex = orderedIds.indexOf(jobId);
      if (currentIndex < 0) {
        throw new Error("Only queued or paused jobs can be moved");
      }
      orderedIds.splice(currentIndex, 1);
      if (to === "top") {
        orderedIds.unshift(jobId);
      } else {
        orderedIds.push(jobId);
      }
      await queue.reorder(orderedIds);
    },

    getJob(jobId) {
      return jobs.get(jobId);
    },

    listJobs() {
      return Array.from(jobs.values()).reverse();
    },

    async recoverOnBoot() {
      let requeuedRunning = 0;
      for (const job of jobs.values()) {
        if (job.status !== "running") {
          continue;
        }
        job.status = "queued";
        pauseRequests.delete(job.id);
        abortControllers.delete(job.id);
        touch(job);
        requeuedRunning += 1;
      }
      if (requeuedRunning > 0) {
        queueLogger.info("Running jobs recovered", { requeuedRunning });
        notifyWaiter();
      }
      return { requeuedRunning };
    },
  };

  return queue;
}
