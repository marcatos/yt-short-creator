import { afterEach, describe, expect, it } from "vitest";

import { SystemClock } from "@/src/adapters/system/clock";
import { UuidIdPort } from "@/src/adapters/system/id";
import { createInProcessJobQueue } from "@/src/adapters/jobs/in-process-queue";
import type { Logger } from "@/src/ports/logger";
import type { JobHandler } from "@/src/workers/handlers";
import { createWorkerRunner } from "@/src/workers/runner";

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
  predicate: () => Promise<boolean>,
  timeoutMs = 2000,
  intervalMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for condition");
}

describe("InProcessJobQueue", () => {
  const runners: Array<{ stop: () => void }> = [];

  afterEach(() => {
    for (const runner of runners.splice(0)) {
      runner.stop();
    }
  });

  it("reflects handler progress at 50 then 100", async () => {
    const logger = createTestLogger();
    const queue = createInProcessJobQueue({
      logger,
      idPort: new UuidIdPort(),
      clock: new SystemClock(),
    });

    const testHandler: JobHandler = async (ctx) => {
      ctx.setProgress(50, "halfway");
      await new Promise((resolve) => setTimeout(resolve, 20));
      ctx.setProgress(100, "done");
    };

    const runner = createWorkerRunner({
      queue,
      handlers: { test: testHandler },
      logger,
      clock: new SystemClock(),
    });
    runners.push(runner);
    runner.start();

    const jobId = await queue.enqueue({ type: "test", payload: { foo: "bar" } });

    await waitFor(async () => {
      const progress = await queue.getProgress(jobId);
      return progress?.pct === 50 && progress.message === "halfway";
    });

    const mid = await queue.getProgress(jobId);
    expect(mid).toEqual({ pct: 50, message: "halfway" });

    await waitFor(async () => {
      const progress = await queue.getProgress(jobId);
      return progress?.pct === 100 && progress.message === "done";
    });

    const final = await queue.getProgress(jobId);
    expect(final).toEqual({ pct: 100, message: "done" });
  });
});
