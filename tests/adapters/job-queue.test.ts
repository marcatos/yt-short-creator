import { afterEach, describe, expect, it } from "vitest";

import { SystemClock } from "@/src/adapters/system/clock";
import { UuidIdPort } from "@/src/adapters/system/id";
import { createInProcessJobQueue } from "@/src/adapters/jobs/in-process-queue";
import type { ClockPort } from "@/src/ports/clock";
import type { Logger } from "@/src/ports/logger";
import type { JobHandler } from "@/src/workers/handlers";
import { createWorkerRunner } from "@/src/workers/runner";

type LogEvent = {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  context: Record<string, unknown>;
};

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

function createRecordingLogger(events: LogEvent[]): Logger {
  function withContext(baseContext: Record<string, unknown>): Logger {
    const record =
      (level: LogEvent["level"]) =>
      (message: string, context: Record<string, unknown> = {}) => {
        events.push({
          level,
          message,
          context: { ...baseContext, ...context },
        });
      };
    return {
      debug: record("debug"),
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
      child: (context) => withContext({ ...baseContext, ...context }),
    };
  }
  return withContext({});
}

class TestClock implements ClockPort {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
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
    expect(mid).toEqual({
      pct: 50,
      message: "halfway",
      status: "running",
      checkpointStep: null,
    });

    await waitFor(async () => {
      const progress = await queue.getProgress(jobId);
      return progress?.pct === 100 && progress.message === "done";
    });

    const final = await queue.getProgress(jobId);
    expect(final).toEqual({
      pct: 100,
      message: "done",
      status: "succeeded",
      checkpointStep: null,
    });
  });

  it("lists newest jobs with status and progress", async () => {
    const queue = createInProcessJobQueue({
      logger: createTestLogger(),
      idPort: new UuidIdPort(),
      clock: new SystemClock(),
    });

    const firstId = await queue.enqueue({
      type: "render_short",
      payload: { candidateId: "candidate-1" },
    });
    const secondId = await queue.enqueue({
      type: "publish_short",
      payload: { candidateId: "candidate-1" },
    });
    queue.markRunning(secondId);
    queue.setProgress(secondId, 42, "Uploading");

    const jobs = queue.listJobs();

    expect(jobs.map((job) => job.id)).toEqual([secondId, firstId]);
    expect(jobs[0]).toMatchObject({
      type: "publish_short",
      status: "running",
      position: 1,
      progressPct: 42,
      progressMessage: "Uploading",
      checkpoint: null,
      error: null,
      updatedAt: expect.any(Date),
    });
  });

  it("claims in the order produced by reorder and top/bottom moves", async () => {
    const queue = createInProcessJobQueue({
      logger: createTestLogger(),
      idPort: new UuidIdPort(),
      clock: new SystemClock(),
    });
    const a = await queue.enqueue({ type: "t", payload: {} });
    const b = await queue.enqueue({ type: "t", payload: {} });
    const c = await queue.enqueue({ type: "t", payload: {} });
    await queue.reorder([c, a, b]);
    await queue.move(b, "top");
    const first = await queue.claimNext();
    expect(first?.id).toBe(b);
    queue.markRunning(b);

    await queue.move(c, "bottom");
    const second = await queue.claimNext();
    expect(second?.id).toBe(a);
    queue.markRunning(a);

    const third = await queue.claimNext();
    expect(third?.id).toBe(c);
  });

  it("pause request + markPaused; resume returns to queued", async () => {
    const queue = createInProcessJobQueue({
      logger: createTestLogger(),
      idPort: new UuidIdPort(),
      clock: new SystemClock(),
    });
    const id = await queue.enqueue({ type: "t", payload: {} });
    await queue.claimNext();
    queue.markRunning(id);
    const paused = await queue.requestPause(id);
    expect(paused.ok).toBe(true);
    expect(queue.isPauseRequested(id)).toBe(true);
    queue.markPaused(id);
    expect(queue.getJob(id)?.status).toBe("paused");
    const resumed = await queue.resume(id);
    expect(resumed.ok).toBe(true);
    expect(queue.getJob(id)?.status).toBe("queued");
  });

  it("cancel aborts running via AbortController", async () => {
    const queue = createInProcessJobQueue({
      logger: createTestLogger(),
      idPort: new UuidIdPort(),
      clock: new SystemClock(),
    });
    const id = await queue.enqueue({ type: "t", payload: {} });
    await queue.claimNext();
    queue.markRunning(id);
    const controller = new AbortController();
    queue.attachAbortController(id, controller);
    const result = await queue.cancel(id);
    expect(result).toBe("aborting");
    expect(controller.signal.aborted).toBe(true);
  });

  it("saveCheckpoint persists step", async () => {
    const queue = createInProcessJobQueue({
      logger: createTestLogger(),
      idPort: new UuidIdPort(),
      clock: new SystemClock(),
    });
    const id = await queue.enqueue({ type: "t", payload: {} });
    await queue.saveCheckpoint(id, "prepare", { foo: 1 });
    expect(queue.getJob(id)?.checkpoint).toEqual({
      step: "prepare",
      data: { foo: 1 },
    });
  });

  it("markFailed stores the failure message", async () => {
    const queue = createInProcessJobQueue({
      logger: createTestLogger(),
      idPort: new UuidIdPort(),
      clock: new SystemClock(),
    });
    const id = await queue.enqueue({ type: "t", payload: {} });

    queue.markFailed(id, new Error("render failed"));

    expect(queue.getJob(id)?.error).toBe("render failed");
  });

  it("setProgress bumps updatedAt", async () => {
    const clock = new TestClock(new Date("2026-08-11T10:00:00.000Z"));
    const queue = createInProcessJobQueue({
      logger: createTestLogger(),
      idPort: new UuidIdPort(),
      clock,
    });
    const id = await queue.enqueue({ type: "t", payload: {} });
    const originalUpdatedAt = queue.getJob(id)?.updatedAt;

    clock.advance(1000);
    queue.setProgress(id, 50, "halfway");

    expect(queue.getJob(id)?.updatedAt.getTime()).toBe(
      originalUpdatedAt!.getTime() + 1000,
    );
  });

  it("logs claims, progress updates, and moves with job context", async () => {
    const events: LogEvent[] = [];
    const queue = createInProcessJobQueue({
      logger: createRecordingLogger(events),
      idPort: new UuidIdPort(),
      clock: new SystemClock(),
    });
    const firstId = await queue.enqueue({ type: "render", payload: {} });
    const secondId = await queue.enqueue({ type: "publish", payload: {} });

    await queue.move(secondId, "top");
    await queue.claimNext();
    queue.setProgress(secondId, 25, "uploading");

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          message: "Job moved",
          context: expect.objectContaining({
            jobId: secondId,
            type: "publish",
            to: "top",
          }),
        }),
        expect.objectContaining({
          level: "info",
          message: "Job claimed",
          context: expect.objectContaining({
            jobId: secondId,
            type: "publish",
          }),
        }),
        expect.objectContaining({
          level: "debug",
          message: "Job progress updated",
          context: expect.objectContaining({
            jobId: secondId,
            type: "publish",
            pct: 25,
          }),
        }),
      ]),
    );
    expect(firstId).not.toBe(secondId);
  });

  it("recoverOnBoot requeues running jobs", async () => {
    const queue = createInProcessJobQueue({
      logger: createTestLogger(),
      idPort: new UuidIdPort(),
      clock: new SystemClock(),
    });
    const id = await queue.enqueue({ type: "t", payload: {} });
    await queue.claimNext();
    queue.markRunning(id);
    await queue.saveCheckpoint(id, "prepare");
    const { requeuedRunning } = await queue.recoverOnBoot();
    expect(requeuedRunning).toBe(1);
    expect(queue.getJob(id)?.status).toBe("queued");
    expect(queue.getJob(id)?.checkpoint?.step).toBe("prepare");
  });
});
