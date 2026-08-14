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

export function shouldEnqueueInspirationSync(input: {
  latestOkSyncAt: Date | null;
  now: Date;
  intervalHours: number;
}): boolean {
  const intervalMs = input.intervalHours * MS_PER_HOUR;
  if (input.latestOkSyncAt === null) {
    return true;
  }
  return (
    input.now.getTime() - input.latestOkSyncAt.getTime() >= intervalMs
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
  store: Pick<InspirationStorePort, "getLatestOkSyncAt">;
  queue: Pick<DurableJobQueue, "listJobs" | "enqueue">;
  intervalHours: number;
  logger: Logger;
  now?: () => Date;
};

/**
 * Enqueues a scheduled Inspiration sync when the interval has elapsed since the
 * last successful sync (or when never synced). At most one scheduled enqueue per
 * interval while no ok sync exists yet.
 */
export async function enqueueScheduledInspirationSyncIfDue(
  deps: EnqueueScheduledInspirationSyncDeps,
): Promise<{ enqueued: boolean }> {
  const log = deps.logger.child({
    operation: "enqueueScheduledInspirationSyncIfDue",
  });
  const now = deps.now?.() ?? new Date();
  const intervalMs = deps.intervalHours * MS_PER_HOUR;
  const latestOkSyncAt = await deps.store.getLatestOkSyncAt();

  if (
    !shouldEnqueueInspirationSync({
      latestOkSyncAt,
      now,
      intervalHours: deps.intervalHours,
    })
  ) {
    return { enqueued: false };
  }

  if (
    latestOkSyncAt === null &&
    lastScheduledEnqueueAt !== null &&
    now.getTime() - lastScheduledEnqueueAt.getTime() < intervalMs
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
    latestOkSyncAt: latestOkSyncAt?.toISOString() ?? null,
  });
  return { enqueued: true };
}

/** Test hook to reset in-memory throttle state. */
export function resetScheduledInspirationSyncState(): void {
  lastScheduledEnqueueAt = null;
}
