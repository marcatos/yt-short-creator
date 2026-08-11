import type { InProcessJobQueue } from "@/src/adapters/jobs/in-process-queue";
import type { ClockPort } from "@/src/ports/clock";
import type { Logger } from "@/src/ports/logger";

import type { JobHandlers } from "./handlers";

type RunnerDeps = {
  queue: InProcessJobQueue;
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
        const startedAt = deps.clock.now();
        runnerLogger.info("Job started", {
          jobId: job.id,
          type: job.type,
        });

        try {
          await handler({
            jobId: job.id,
            payload: job.payload,
            setProgress: (pct, message) => {
              deps.queue.setProgress(job.id, pct, message);
            },
          });
          deps.queue.markSucceeded(job.id);
          const durationMs = deps.clock.now().getTime() - startedAt.getTime();
          runnerLogger.info("Job finished", {
            jobId: job.id,
            type: job.type,
            status: "succeeded",
            durationMs,
          });
        } catch (error) {
          deps.queue.markFailed(job.id, error);
          const durationMs = deps.clock.now().getTime() - startedAt.getTime();
          runnerLogger.error("Job finished", {
            jobId: job.id,
            type: job.type,
            status: "failed",
            durationMs,
            error: error instanceof Error ? error.message : String(error),
          });
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
