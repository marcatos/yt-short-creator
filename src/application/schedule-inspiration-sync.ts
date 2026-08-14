import type { JobRecord } from "@/src/adapters/jobs/job-record";
import type { InspirationStorePort } from "@/src/ports/inspiration-store";
import type { DurableJobQueue } from "@/src/ports/job-queue";
import type { Logger } from "@/src/ports/logger";

const MS_PER_HOUR = 60 * 60 * 1000;

const ACTIVE_SYNC_JOB_STATUSES = new Set<JobRecord["status"]>([
  "queued",
  "running",
  "paused",
]);

let lastScheduledEnqueueAt: Date | null = null;

function laterDate(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

export function shouldEnqueueInspirationSync(input: {
  latestOkSyncAt?: Date | null;
  lastAttemptAt?: Date | null;
  now: Date;
  intervalHours: number;
}): boolean {
  const lastAttemptAt = laterDate(
    input.lastAttemptAt ?? null,
    input.latestOkSyncAt ?? null,
  );
  if (lastAttemptAt === null) {
    return true;
  }
  return (
    input.now.getTime() - lastAttemptAt.getTime() >=
    input.intervalHours * MS_PER_HOUR
  );
}

function hasActiveSyncInspirationJob(
  jobs: JobRecord[],
): boolean {
  return jobs.some(
    (job) =>
      job.type === "sync_inspiration" &&
      ACTIVE_SYNC_JOB_STATUSES.has(job.status),
  );
}

type EnqueueScheduledInspirationSyncDeps = {
  store: Pick<InspirationStorePort, "getLatestFinishedSyncAt">;
  queue: Pick<DurableJobQueue, "listJobs" | "enqueue">;
  intervalHours: number;
  logger: Logger;
  now?: () => Date;
};

/**
 * Enqueues a scheduled Inspiration sync when the interval has elapsed since the
 * last finished sync attempt (any status) or in-memory scheduled enqueue.
 */
export async function enqueueScheduledInspirationSyncIfDue(
  deps: EnqueueScheduledInspirationSyncDeps,
): Promise<{ enqueued: boolean }> {
  const log = deps.logger.child({
    operation: "enqueueScheduledInspirationSyncIfDue",
  });
  const now = deps.now?.() ?? new Date();
  const latestFinishedAt = await deps.store.getLatestFinishedSyncAt();
  const lastAttemptAt = laterDate(latestFinishedAt, lastScheduledEnqueueAt);

  if (
    !shouldEnqueueInspirationSync({
      lastAttemptAt,
      now,
      intervalHours: deps.intervalHours,
    })
  ) {
    return { enqueued: false };
  }

  if (hasActiveSyncInspirationJob(deps.queue.listJobs())) {
    log.debug("Skipping scheduled Inspiration sync; job already active");
    return { enqueued: false };
  }

  const jobId = await deps.queue.enqueue({
    type: "sync_inspiration",
    payload: { source: "scheduled" },
  });
  lastScheduledEnqueueAt = now;
  log.info("Enqueued scheduled Inspiration sync", {
    jobId,
    intervalHours: deps.intervalHours,
    lastAttemptAt: lastAttemptAt?.toISOString() ?? null,
  });
  return { enqueued: true };
}

/** Test hook to reset in-memory throttle state. */
export function resetScheduledInspirationSyncState(): void {
  lastScheduledEnqueueAt = null;
}
