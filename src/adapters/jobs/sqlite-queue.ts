import {
  applyOrder,
  createQueuedJobRecord,
  movedOrder,
  nextPosition,
  recoverRunningJobs,
} from "@/src/adapters/jobs/in-process-queue-helpers";
import type { JobRecord } from "@/src/adapters/jobs/job-record";
import {
  persistJobWithLogging,
  readQueuedForClaim,
} from "@/src/adapters/jobs/sqlite-queue-observability";
import {
  insertJob,
  listJobsByDisplayOrder,
  loadJobs,
  readJob,
  type SqliteQueueDeps,
} from "@/src/adapters/jobs/sqlite-queue-storage";
import type { DurableJobQueue } from "@/src/ports/job-queue";

type JobMutation = (job: JobRecord) => void;

export function createSqliteJobQueue(deps: SqliteQueueDeps): DurableJobQueue {
  const pauseRequests = new Set<string>();
  const abortControllers = new Map<string, AbortController>();
  const queueLogger = deps.logger.child({ component: "SqliteJobQueue" });
  let wake: (() => void) | null = null;

  function notifyWaiter(): void {
    wake?.();
    wake = null;
  }

  function waitForWork(): Promise<void> {
    if (readQueuedForClaim(deps.db, queueLogger)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      wake = resolve;
    });
  }

  function mutate(jobId: string, mutation: JobMutation): JobRecord | undefined {
    const job = readJob(deps.db, jobId);
    if (!job) {
      return undefined;
    }
    mutation(job);
    job.updatedAt = deps.clock.now();
    persistJobWithLogging(deps.db, queueLogger, job, "mutation");
    return job;
  }

  function clearRuntimeState(jobId: string): void {
    pauseRequests.delete(jobId);
    abortControllers.delete(jobId);
  }

  const queue: DurableJobQueue = {
    async enqueue(job) {
      const jobs = loadJobs(deps.db);
      const id = deps.idPort.generate();
      const position = nextPosition(jobs);
      const record = createQueuedJobRecord(job, id, position, deps.clock.now());
      insertJob(deps.db, record);
      queueLogger.info("Job enqueued", { jobId: id, type: job.type, position });
      notifyWaiter();
      return id;
    },

    async getProgress(jobId) {
      const job = readJob(deps.db, jobId);
      return job
        ? {
            pct: job.progressPct,
            message: job.progressMessage,
            status: job.status,
            checkpointStep: job.checkpoint?.step ?? null,
          }
        : null;
    },

    async claimNext() {
      const startedAt = Date.now();
      let next = readQueuedForClaim(deps.db, queueLogger);
      while (!next) {
        await waitForWork();
        next = readQueuedForClaim(deps.db, queueLogger);
      }
      queueLogger.info("Job claimed", {
        jobId: next.id,
        type: next.type,
        position: next.position,
        durationMs: Date.now() - startedAt,
      });
      return next;
    },

    setProgress(jobId, pct, message) {
      const job = mutate(jobId, (record) => {
        record.progressPct = pct;
        record.progressMessage = message;
      });
      if (job) {
        queueLogger.debug("Job progress updated", {
          jobId,
          type: job.type,
          pct,
        });
      }
    },

    async saveCheckpoint(jobId, step, data) {
      mutate(jobId, (job) => {
        job.checkpoint = data === undefined ? { step } : { step, data };
      });
      queueLogger.debug("Job checkpoint saved", { jobId, step });
    },

    markRunning(jobId) {
      mutate(jobId, (job) => {
        job.status = "running";
        job.startedAt = deps.clock.now();
      });
    },

    markSucceeded(jobId) {
      mutate(jobId, (job) => {
        job.status = "succeeded";
        job.finishedAt = deps.clock.now();
      });
      clearRuntimeState(jobId);
    },

    markFailed(jobId, error) {
      const job = mutate(jobId, (record) => {
        record.status = "failed";
        record.finishedAt = deps.clock.now();
        record.error = error instanceof Error ? error.message : String(error);
      });
      clearRuntimeState(jobId);
      if (job) {
        queueLogger.error("Job failed", {
          jobId,
          type: job.type,
          error: job.error,
        });
      }
    },

    markPaused(jobId) {
      mutate(jobId, (job) => {
        job.status = "paused";
      });
      clearRuntimeState(jobId);
      queueLogger.info("Job paused", { jobId });
    },

    markCancelled(jobId) {
      mutate(jobId, (job) => {
        job.status = "cancelled";
        job.finishedAt = deps.clock.now();
      });
      clearRuntimeState(jobId);
      queueLogger.info("Job cancelled", { jobId });
    },

    async requestPause(jobId) {
      const job = readJob(deps.db, jobId);
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
      mutate(jobId, () => {});
      queueLogger.info("Job pause requested", { jobId });
      return { ok: true };
    },

    async resume(jobId) {
      const job = readJob(deps.db, jobId);
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
      mutate(jobId, (record) => {
        record.status = "queued";
      });
      clearRuntimeState(jobId);
      queueLogger.info("Job resumed", { jobId });
      notifyWaiter();
      return { ok: true };
    },

    async cancel(jobId) {
      const job = readJob(deps.db, jobId);
      if (!job) {
        return "noop";
      }
      if (job.status === "queued" || job.status === "paused") {
        queue.markCancelled(jobId);
        return "cancelled";
      }
      if (job.status === "running") {
        abortControllers.get(jobId)?.abort();
        mutate(jobId, () => {});
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
      mutate(jobId, () => {});
    },

    attachAbortController(jobId, controller) {
      abortControllers.set(jobId, controller);
      mutate(jobId, () => {});
    },

    getAbortSignal(jobId) {
      return abortControllers.get(jobId)?.signal ?? null;
    },

    clearAbortController(jobId) {
      abortControllers.delete(jobId);
      mutate(jobId, () => {});
    },

    async reorder(orderedIds) {
      // better-sqlite3 is synchronous, so wrapping the read-modify-write in a
      // transaction makes the whole reorder atomic: either every touched job
      // gets its new position persisted, or none do.
      deps.db.transaction((tx) => {
        const jobs = loadJobs(tx);
        applyOrder(jobs, orderedIds, (job) => {
          job.updatedAt = deps.clock.now();
        });
        for (const job of jobs.values()) {
          if (job.status === "queued" || job.status === "paused") {
            persistJobWithLogging(tx, queueLogger, job, "reorder");
          }
        }
      });
      queueLogger.info("Jobs reordered", { jobCount: orderedIds.length });
      notifyWaiter();
    },

    async move(jobId, to) {
      const jobs = loadJobs(deps.db);
      const job = jobs.get(jobId);
      await queue.reorder(movedOrder(jobs, jobId, to));
      queueLogger.info("Job moved", { jobId, type: job?.type, to });
    },

    getJob(jobId) {
      return readJob(deps.db, jobId);
    },

    listJobs() {
      return listJobsByDisplayOrder(deps.db);
    },

    async recoverOnBoot() {
      const jobs = loadJobs(deps.db);
      const runningIds = Array.from(jobs.values(), (job) => job)
        .filter((job) => job.status === "running")
        .map(({ id }) => id);
      const requeuedRunning = recoverRunningJobs(
        jobs,
        pauseRequests,
        abortControllers,
        (job) => {
          job.updatedAt = deps.clock.now();
        },
      );
      for (const jobId of runningIds) {
        persistJobWithLogging(
          deps.db,
          queueLogger,
          jobs.get(jobId)!,
          "recover",
        );
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
