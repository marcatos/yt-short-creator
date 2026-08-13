import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";

import { createDb } from "@/src/adapters/db/client";
import * as schema from "@/src/adapters/db/schema";
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

  it("pauses a running job and resumes it as queued", async () => {
    const connection = createQueue(createDbPath());
    const jobId = await connection.queue.enqueue({ type: "render", payload: {} });
    connection.queue.markRunning(jobId);

    await expect(connection.queue.requestPause(jobId)).resolves.toEqual({ ok: true });
    expect(connection.queue.isPauseRequested(jobId)).toBe(true);

    connection.queue.markPaused(jobId);
    expect(connection.queue.getJob(jobId)?.status).toBe("paused");
    await expect(connection.queue.resume(jobId)).resolves.toEqual({ ok: true });
    expect(connection.queue.getJob(jobId)?.status).toBe("queued");
    connection.connection.close();
  });

  it("aborts a running job when cancellation is requested", async () => {
    const connection = createQueue(createDbPath());
    const jobId = await connection.queue.enqueue({ type: "render", payload: {} });
    connection.queue.markRunning(jobId);
    const controller = new AbortController();
    connection.queue.attachAbortController(jobId, controller);

    await expect(connection.queue.cancel(jobId)).resolves.toBe("aborting");
    expect(controller.signal.aborted).toBe(true);
    connection.connection.close();
  });

  it("claims jobs in reordered and moved order", async () => {
    const connection = createQueue(createDbPath());
    const firstId = await connection.queue.enqueue({ type: "first", payload: {} });
    const secondId = await connection.queue.enqueue({ type: "second", payload: {} });
    const thirdId = await connection.queue.enqueue({ type: "third", payload: {} });

    await connection.queue.reorder([thirdId, firstId, secondId]);
    await connection.queue.move(secondId, "top");
    expect((await connection.queue.claimNext())?.id).toBe(secondId);
    connection.queue.markRunning(secondId);

    await connection.queue.move(thirdId, "bottom");
    expect((await connection.queue.claimNext())?.id).toBe(firstId);
    connection.connection.close();
  });

  it("persists progress across reopen", async () => {
    const dbPath = createDbPath();
    const first = createQueue(dbPath);
    const jobId = await first.queue.enqueue({ type: "render", payload: {} });
    first.queue.setProgress(jobId, 57, "Encoding");
    first.connection.close();

    const second = createQueue(dbPath);
    await expect(second.queue.getProgress(jobId)).resolves.toMatchObject({
      pct: 57,
      message: "Encoding",
    });
    second.connection.close();
  });

  it("lists active jobs before terminal jobs", async () => {
    const connection = createQueue(createDbPath());
    const terminalId = await connection.queue.enqueue({ type: "done", payload: {} });
    connection.queue.markSucceeded(terminalId);
    const queuedId = await connection.queue.enqueue({ type: "queued", payload: {} });
    const runningId = await connection.queue.enqueue({ type: "running", payload: {} });
    connection.queue.markRunning(runningId);

    expect(connection.queue.listJobs().map(({ id }) => id)).toEqual([
      runningId,
      queuedId,
      terminalId,
    ]);
    connection.connection.close();
  });

  it("bounds terminal job history while keeping all active jobs", async () => {
    const connection = createQueue(createDbPath());
    const queuedId = await connection.queue.enqueue({ type: "queued", payload: {} });

    const terminalIds: string[] = [];
    for (let i = 0; i < 55; i += 1) {
      const id = await connection.queue.enqueue({ type: "done", payload: {} });
      connection.queue.markSucceeded(id);
      terminalIds.push(id);
    }

    const jobs = connection.queue.listJobs();
    const listedIds = new Set(jobs.map(({ id }) => id));

    expect(listedIds.has(queuedId)).toBe(true);
    expect(jobs.filter((job) => job.status === "succeeded")).toHaveLength(50);
    expect(jobs).toHaveLength(51);
    connection.connection.close();
  });

  it("wakes claimNext when another process enqueues via SQLite", async () => {
    const dbPath = createDbPath();
    const waiter = createQueue(dbPath);
    const claimPromise = waiter.queue.claimNext();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const enqueuer = createQueue(dbPath);
    const jobId = await enqueuer.queue.enqueue({ type: "cross_process", payload: {} });
    enqueuer.connection.close();

    await expect(claimPromise).resolves.toMatchObject({ id: jobId, type: "cross_process" });
    waiter.connection.close();
  }, 5_000);

  it("claims with a bounded ordered SQL query", async () => {
    const dbPath = createDbPath();
    const sqlite = new Database(dbPath);
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = drizzle(sqlite, {
      schema,
      logger: {
        logQuery(sql, params) {
          queries.push({ sql, params });
        },
      },
    });
    migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    const queue = createSqliteJobQueue({
      db,
      logger: createTestLogger(),
      idPort: new UuidIdPort(),
      clock: new SystemClock(),
    });
    await queue.enqueue({ type: "render", payload: {} });
    queries.length = 0;

    await queue.claimNext();

    const claimQuery = queries.find(({ sql }) => /from [`"]queue_jobs[`"]/.test(sql));
    sqlite.close();
    expect(claimQuery?.sql.replace(/\s+/g, " ").toLowerCase()).toMatch(
      /where .*status.* = \? order by .*position.* asc limit \?/,
    );
    expect(claimQuery?.params).toEqual(["queued", 1]);
  });

  it("clears only terminal jobs from the queue", async () => {
    const dbPath = createDbPath();
    const { connection, queue } = createQueue(dbPath);
    const activeId = await queue.enqueue({ type: "render", payload: {} });
    const doneId = await queue.enqueue({ type: "publish", payload: {} });
    const failedId = await queue.enqueue({ type: "analyze", payload: {} });
    const cancelledId = await queue.enqueue({ type: "sync", payload: {} });
    queue.markRunning(activeId);
    queue.markSucceeded(doneId);
    queue.markFailed(failedId, new Error("boom"));
    queue.markCancelled(cancelledId);

    expect(queue.clearTerminalJobs()).toBe(3);
    expect(queue.getJob(activeId)?.status).toBe("running");
    expect(queue.getJob(doneId)).toBeUndefined();
    expect(queue.getJob(failedId)).toBeUndefined();
    expect(queue.getJob(cancelledId)).toBeUndefined();
    expect(queue.listJobs().map((job) => job.id)).toEqual([activeId]);
    connection.close();
  });
});
