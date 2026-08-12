import {
  isJobCancelledError,
  isJobPausedError,
  JobCancelledError,
  JobPausedError,
} from "@/src/domain/queue-control";
import type { ClockPort } from "@/src/ports/clock";
import type { DurableJobQueue } from "@/src/ports/job-queue";
import type { Logger } from "@/src/ports/logger";

import type { JobHandlers } from "./handlers";
import type { JobHandlerContext } from "./job-handler-context";

type RunnerDeps = {
  queue: DurableJobQueue;
  handlers: JobHandlers;
  logger: Logger;
  clock: ClockPort;
};

export type WorkerRunner = {
  start(): void;
  stop(): void;
};

export function createWorkerRunner(deps: RunnerDeps): WorkerRunner {
  const runnerLogger = deps.logger.child({ component: "WorkerRunner" });
  let running = false;
  let active = false;

  async function processLoop(): Promise<void> {
    if (active) {
      return;
    }
    active = true;

    try {
      while (running) {
        const job = await deps.queue.claimNext();
        if (!job || !running) {
          break;
        }

        const handler = deps.handlers[job.type];
        if (!handler) {
          deps.queue.markFailed(job.id, new Error(`No handler for job type: ${job.type}`));
          continue;
        }

        deps.queue.markRunning(job.id);
        const controller = new AbortController();
        deps.queue.attachAbortController(job.id, controller);
        deps.queue.clearPauseRequest(job.id);
        const startedAt = deps.clock.now();
        runnerLogger.info("Job started", {
          jobId: job.id,
          type: job.type,
        });
        const throwIfPausedOrCancelled = () => {
          if (controller.signal.aborted) {
            throw new JobCancelledError();
          }
          if (deps.queue.isPauseRequested(job.id)) {
            throw new JobPausedError();
          }
        };

        // Mirrors the store so handlers (and runStep) can read back what they
        // just checkpointed without another queue round-trip.
        const ctx: JobHandlerContext = {
          jobId: job.id,
          payload: job.payload,
          checkpoint: job.checkpoint,
          setProgress: (pct, message) => {
            deps.queue.setProgress(job.id, pct, message);
          },
          saveCheckpoint: async (step, data) => {
            await deps.queue.saveCheckpoint(job.id, step, data);
            ctx.checkpoint = data === undefined ? { step } : { step, data };
          },
          signal: controller.signal,
          shouldPause: () => deps.queue.isPauseRequested(job.id),
          throwIfPausedOrCancelled,
        };

        try {
          await handler(ctx);
          const durationMs = deps.clock.now().getTime() - startedAt.getTime();
          if (controller.signal.aborted) {
            deps.queue.markCancelled(job.id);
            runnerLogger.info("Job finished", {
              jobId: job.id,
              type: job.type,
              status: "cancelled",
              durationMs,
            });
          } else {
            deps.queue.markSucceeded(job.id);
            runnerLogger.info("Job finished", {
              jobId: job.id,
              type: job.type,
              status: "succeeded",
              durationMs,
            });
          }
        } catch (error) {
          const durationMs = deps.clock.now().getTime() - startedAt.getTime();
          if (isJobPausedError(error)) {
            deps.queue.markPaused(job.id);
            runnerLogger.info("Job finished", {
              jobId: job.id,
              type: job.type,
              status: "paused",
              durationMs,
            });
          } else if (isJobCancelledError(error) || controller.signal.aborted) {
            deps.queue.markCancelled(job.id);
            runnerLogger.info("Job finished", {
              jobId: job.id,
              type: job.type,
              status: "cancelled",
              durationMs,
            });
          } else {
            deps.queue.markFailed(job.id, error);
            runnerLogger.error("Job finished", {
              jobId: job.id,
              type: job.type,
              status: "failed",
              durationMs,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        } finally {
          deps.queue.clearAbortController(job.id);
          deps.queue.clearPauseRequest(job.id);
        }
      }
    } finally {
      active = false;
    }
  }

  return {
    start() {
      if (running) {
        return;
      }
      running = true;
      runnerLogger.info("Worker runner started", { concurrency: 1 });
      void processLoop();
    },

    stop() {
      running = false;
      runnerLogger.info("Worker runner stopped");
    },
  };
}
