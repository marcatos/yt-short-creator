import { afterEach, describe, expect, it } from "vitest";

import { createInProcessJobQueue } from "@/src/adapters/jobs/in-process-queue";
import { SystemClock } from "@/src/adapters/system/clock";
import { UuidIdPort } from "@/src/adapters/system/id";
import type { Logger } from "@/src/ports/logger";
import type { JobHandler } from "@/src/workers/handlers";
import {
  createWorkerRunner,
  type WorkerRunner,
} from "@/src/workers/runner";

function createTestLogger(): Logger {
  const noop = () => {};
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
  };
  return logger;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

describe("WorkerRunner control", () => {
  const runners: WorkerRunner[] = [];

  afterEach(() => {
    for (const runner of runners.splice(0)) runner.stop();
  });

  function setup(handler: JobHandler) {
    const logger = createTestLogger();
    const clock = new SystemClock();
    const queue = createInProcessJobQueue({
      logger,
      clock,
      idPort: new UuidIdPort(),
    });
    const runner = createWorkerRunner({
      queue,
      handlers: { controlled: handler },
      logger,
      clock,
    });
    runners.push(runner);
    return { queue, runner };
  }

  it("marks paused when handler throws JobPausedError", async () => {
    const { queue, runner } = setup(async (ctx) => {
      await waitFor(() => ctx.shouldPause());
      ctx.throwIfPausedOrCancelled();
    });
    const jobId = await queue.enqueue({ type: "controlled", payload: {} });
    runner.start();

    await waitFor(() => queue.getJob(jobId)?.status === "running");
    await queue.requestPause(jobId);

    await waitFor(() => queue.getJob(jobId)?.status === "paused");
    expect(queue.getJob(jobId)?.status).toBe("paused");
  });

  it("marks cancelled when AbortSignal aborts", async () => {
    const { queue, runner } = setup(
      (ctx) =>
        new Promise<void>((_resolve, reject) => {
          ctx.signal.addEventListener(
            "abort",
            () => {
              try {
                ctx.throwIfPausedOrCancelled();
              } catch (error) {
                reject(error);
              }
            },
            { once: true },
          );
        }),
    );
    const jobId = await queue.enqueue({ type: "controlled", payload: {} });
    runner.start();

    await waitFor(() => queue.getJob(jobId)?.status === "running");
    expect(await queue.cancel(jobId)).toBe("aborting");

    await waitFor(() => queue.getJob(jobId)?.status === "cancelled");
    expect(queue.getJob(jobId)?.status).toBe("cancelled");
  });

  it("marks cancelled when handler succeeds but signal was aborted", async () => {
    const { queue, runner } = setup(
      (ctx) =>
        new Promise<void>((resolve) => {
          ctx.signal.addEventListener("abort", () => resolve(), { once: true });
        }),
    );
    const jobId = await queue.enqueue({ type: "controlled", payload: {} });
    runner.start();

    await waitFor(() => queue.getJob(jobId)?.status === "running");
    expect(await queue.cancel(jobId)).toBe("aborting");

    await waitFor(() => queue.getJob(jobId)?.status === "cancelled");
    expect(queue.getJob(jobId)?.status).toBe("cancelled");
  });

  it("passes prior checkpoint into handler on resume", async () => {
    let checkpointStep: string | null = null;
    const { queue, runner } = setup(async (ctx) => {
      checkpointStep = ctx.checkpoint?.step ?? null;
    });
    const jobId = await queue.enqueue({ type: "controlled", payload: {} });
    await queue.saveCheckpoint(jobId, "downloaded", { path: "source.mp4" });

    runner.start();

    await waitFor(() => queue.getJob(jobId)?.status === "succeeded");
    expect(checkpointStep).toBe("downloaded");
  });
});
