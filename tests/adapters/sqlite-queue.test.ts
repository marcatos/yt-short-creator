import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDb } from "@/src/adapters/db/client";
import { createSqliteJobQueue } from "@/src/adapters/jobs/sqlite-queue";
import { SystemClock } from "@/src/adapters/system/clock";
import { UuidIdPort } from "@/src/adapters/system/id";
import type { Logger } from "@/src/ports/logger";

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

function createQueue(dbPath: string) {
  const connection = createDb(dbPath);
  const queue = createSqliteJobQueue({
    db: connection.db,
    logger: createTestLogger(),
    idPort: new UuidIdPort(),
    clock: new SystemClock(),
  });
  return { connection, queue };
}

describe("SqliteJobQueue", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function createDbPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "queue-"));
    dirs.push(dir);
    return path.join(dir, "test.db");
  }

  it("survives reopen with queued order and checkpoint", async () => {
    const dbPath = createDbPath();
    const first = createQueue(dbPath);
    const earlierId = await first.queue.enqueue({
      type: "download_source_video",
      payload: { sourceVideoId: "s1" },
    });
    const laterId = await first.queue.enqueue({
      type: "render_short",
      payload: { candidateId: "c1" },
    });
    await first.queue.reorder([laterId, earlierId]);
    await first.queue.saveCheckpoint(laterId, "download", { path: "/tmp/x" });
    first.connection.close();

    const second = createQueue(dbPath);
    const job = second.queue.getJob(laterId);
    expect(job?.status).toBe("queued");
    expect(job?.checkpoint).toEqual({
      step: "download",
      data: { path: "/tmp/x" },
    });
    expect((await second.queue.claimNext())?.id).toBe(laterId);
    second.connection.close();
  });

  it("requeues running jobs on boot while preserving checkpoints", async () => {
    const dbPath = createDbPath();
    const first = createQueue(dbPath);
    const jobId = await first.queue.enqueue({ type: "render", payload: {} });
    first.queue.markRunning(jobId);
    await first.queue.saveCheckpoint(jobId, "prepare", { frame: 42 });
    first.connection.close();

    const second = createQueue(dbPath);
    await expect(second.queue.recoverOnBoot()).resolves.toEqual({
      requeuedRunning: 1,
    });
    expect(second.queue.getJob(jobId)).toMatchObject({
      status: "queued",
      checkpoint: { step: "prepare", data: { frame: 42 } },
    });
    second.connection.close();
  });
});
