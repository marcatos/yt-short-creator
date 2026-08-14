import { beforeEach, describe, expect, it } from "vitest";

import {
  enqueueScheduledInspirationSyncIfDue,
  resetScheduledInspirationSyncState,
  shouldEnqueueInspirationSync,
} from "@/src/application/schedule-inspiration-sync";
import type { JobRecord } from "@/src/adapters/jobs/job-record";
import type { Logger } from "@/src/ports/logger";

function silentLogger(): Logger {
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child: () => logger,
  };
  return logger;
}

describe("shouldEnqueueInspirationSync", () => {
  const intervalHours = 24;
  const now = new Date("2026-08-14T12:00:00.000Z");

  it("returns true when last ok sync was longer ago than the interval", () => {
    const latestOkSyncAt = new Date("2026-08-13T11:00:00.000Z");
    expect(
      shouldEnqueueInspirationSync({ latestOkSyncAt, now, intervalHours }),
    ).toBe(true);
  });

  it("returns false when last ok sync was within the interval", () => {
    const latestOkSyncAt = new Date("2026-08-14T11:00:00.000Z");
    expect(
      shouldEnqueueInspirationSync({ latestOkSyncAt, now, intervalHours }),
    ).toBe(false);
  });

  it("returns true when there has never been an ok sync", () => {
    expect(
      shouldEnqueueInspirationSync({
        latestOkSyncAt: null,
        now,
        intervalHours,
      }),
    ).toBe(true);
  });

  it("returns false when a later failed attempt is still within the interval", () => {
    expect(
      shouldEnqueueInspirationSync({
        latestOkSyncAt: new Date("2026-08-13T11:00:00.000Z"),
        lastAttemptAt: new Date("2026-08-14T11:00:00.000Z"),
        now,
        intervalHours,
      }),
    ).toBe(false);
  });
});

describe("enqueueScheduledInspirationSyncIfDue", () => {
  const intervalHours = 24;
  const now = new Date("2026-08-14T12:00:00.000Z");
  const okAt = new Date("2026-08-13T11:00:00.000Z");
  const failedAt = new Date("2026-08-14T11:00:00.000Z");

  beforeEach(() => {
    resetScheduledInspirationSyncState();
  });

  it("does not re-enqueue within the interval after a failed follow-up sync", async () => {
    const enqueued: Array<{ type: string; payload: Record<string, unknown> }> =
      [];
    const result = await enqueueScheduledInspirationSyncIfDue({
      store: {
        getLatestOkSyncAt: async () => okAt,
        getLatestFinishedSyncAt: async () => failedAt,
      },
      queue: {
        listJobs: () => [] as JobRecord[],
        enqueue: async (job) => {
          enqueued.push(job);
          return "job-1";
        },
      },
      intervalHours,
      logger: silentLogger(),
      now: () => now,
    });

    expect(result.enqueued).toBe(false);
    expect(enqueued).toHaveLength(0);
  });

  it("enqueues when the last finished sync is older than the interval", async () => {
    const enqueued: Array<{ type: string; payload: Record<string, unknown> }> =
      [];
    const result = await enqueueScheduledInspirationSyncIfDue({
      store: {
        getLatestOkSyncAt: async () => okAt,
        getLatestFinishedSyncAt: async () => okAt,
      },
      queue: {
        listJobs: () => [] as JobRecord[],
        enqueue: async (job) => {
          enqueued.push(job);
          return "job-1";
        },
      },
      intervalHours,
      logger: silentLogger(),
      now: () => now,
    });

    expect(result.enqueued).toBe(true);
    expect(enqueued).toEqual([
      { type: "sync_inspiration", payload: { source: "scheduled" } },
    ]);
  });

  it("throttles a second scheduled enqueue 15 minutes later using in-memory last attempt", async () => {
    const enqueued: string[] = [];
    const store = {
      getLatestOkSyncAt: async () => okAt,
      getLatestFinishedSyncAt: async () => okAt,
    };
    const queue = {
      listJobs: () => [] as JobRecord[],
      enqueue: async () => {
        enqueued.push("job");
        return `job-${enqueued.length}`;
      },
    };

    const first = await enqueueScheduledInspirationSyncIfDue({
      store,
      queue,
      intervalHours,
      logger: silentLogger(),
      now: () => now,
    });
    const fifteenMinutesLater = new Date(now.getTime() + 15 * 60 * 1000);
    const second = await enqueueScheduledInspirationSyncIfDue({
      store,
      queue,
      intervalHours,
      logger: silentLogger(),
      now: () => fifteenMinutesLater,
    });

    expect(first.enqueued).toBe(true);
    expect(second.enqueued).toBe(false);
    expect(enqueued).toHaveLength(1);
  });
});
