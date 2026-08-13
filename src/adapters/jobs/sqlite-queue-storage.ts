import { asc, desc, eq, inArray } from "drizzle-orm";

import type { AppDb } from "@/src/adapters/db/client";
import { queueJobs } from "@/src/adapters/db/schema";
import type { JobRecord } from "@/src/adapters/jobs/job-record";
import type { InProcessQueueDeps } from "@/src/adapters/jobs/in-process-queue-helpers";

export type SqliteQueueDeps = InProcessQueueDeps & {
  db: AppDb;
  /** When set, claimNext skips queued jobs that return false (e.g. publish while quota blocked). */
  canClaimJob?: (job: JobRecord) => boolean;
};

/**
 * Accepts either the top-level AppDb or the transaction handle passed into
 * `db.transaction(tx => ...)`. Both support the same select/insert/update
 * query builder API used here; only their client-handle types differ.
 */
export type Queryable = Parameters<AppDb["transaction"]>[0] extends (
  tx: infer Tx,
) => unknown
  ? Tx | AppDb
  : never;

export function loadJobs(db: Queryable): Map<string, JobRecord> {
  const rows = db.select().from(queueJobs).all();
  return new Map(rows.map((row) => [row.id, row]));
}

export function readJob(db: Queryable, jobId: string): JobRecord | undefined {
  return db
    .select()
    .from(queueJobs)
    .where(eq(queueJobs.id, jobId))
    .get();
}

export function readNextQueuedJob(db: Queryable): JobRecord | undefined {
  return db
    .select()
    .from(queueJobs)
    .where(eq(queueJobs.status, "queued"))
    .orderBy(asc(queueJobs.position))
    .limit(1)
    .get();
}

/** Queued jobs in claim order (position asc). */
export function listQueuedJobsOrdered(db: Queryable): JobRecord[] {
  return db
    .select()
    .from(queueJobs)
    .where(eq(queueJobs.status, "queued"))
    .orderBy(asc(queueJobs.position))
    .all();
}

export function insertJob(db: Queryable, job: JobRecord): void {
  db.insert(queueJobs).values(job).run();
}

export function persistJob(db: Queryable, job: JobRecord): void {
  db.update(queueJobs)
    .set({
      type: job.type,
      payload: job.payload,
      status: job.status,
      position: job.position,
      progressPct: job.progressPct,
      progressMessage: job.progressMessage,
      checkpoint: job.checkpoint,
      error: job.error,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      updatedAt: job.updatedAt,
    })
    .where(eq(queueJobs.id, job.id))
    .run();
}

const ACTIVE_STATUSES = ["running", "queued", "paused"] as const;
const TERMINAL_STATUSES = ["succeeded", "failed", "cancelled"] as const;

/**
 * Caps how much terminal (finished) job history the queue keeps visible so
 * that the jobs list stays bounded as the table grows without limit. Active
 * jobs (queued/running/paused) are never truncated.
 */
export const TERMINAL_JOB_DISPLAY_LIMIT = 50;

export function listJobsByDisplayOrder(db: Queryable): JobRecord[] {
  const activeJobs = db
    .select()
    .from(queueJobs)
    .where(inArray(queueJobs.status, ACTIVE_STATUSES))
    .all();

  const terminalJobs = db
    .select()
    .from(queueJobs)
    .where(inArray(queueJobs.status, TERMINAL_STATUSES))
    .orderBy(desc(queueJobs.updatedAt))
    .limit(TERMINAL_JOB_DISPLAY_LIMIT)
    .all();

  return [...activeJobs, ...terminalJobs].sort((left, right) => {
    const leftGroup = statusGroup(left);
    const rightGroup = statusGroup(right);
    if (leftGroup !== rightGroup) {
      return leftGroup - rightGroup;
    }
    if (leftGroup === 1) {
      return left.position - right.position;
    }
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  });
}

function statusGroup(job: JobRecord): number {
  if (job.status === "running") {
    return 0;
  }
  if (job.status === "queued" || job.status === "paused") {
    return 1;
  }
  return 2;
}

export function clearTerminalJobs(db: Queryable): number {
  const result = db
    .delete(queueJobs)
    .where(inArray(queueJobs.status, TERMINAL_STATUSES))
    .run();
  return result.changes;
}
