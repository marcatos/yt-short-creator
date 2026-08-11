import { eq } from "drizzle-orm";

import type { AppDb } from "@/src/adapters/db/client";
import { queueJobs } from "@/src/adapters/db/schema";
import type { JobRecord } from "@/src/adapters/jobs/job-record";
import type { InProcessQueueDeps } from "@/src/adapters/jobs/in-process-queue-helpers";

export type SqliteQueueDeps = InProcessQueueDeps & {
  db: AppDb;
};

export function loadJobs(db: AppDb): Map<string, JobRecord> {
  const rows = db.select().from(queueJobs).all();
  return new Map(rows.map((row) => [row.id, row]));
}

export function readJob(db: AppDb, jobId: string): JobRecord | undefined {
  return db
    .select()
    .from(queueJobs)
    .where(eq(queueJobs.id, jobId))
    .get();
}

export function insertJob(db: AppDb, job: JobRecord): void {
  db.insert(queueJobs).values(job).run();
}

export function persistJob(db: AppDb, job: JobRecord): void {
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

export function listJobsByDisplayOrder(db: AppDb): JobRecord[] {
  const jobs = Array.from(loadJobs(db).values());
  return jobs.sort((left, right) => {
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
