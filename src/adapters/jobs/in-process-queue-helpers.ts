import type { JobRecord } from "@/src/adapters/jobs/job-record";
import type { ClockPort } from "@/src/ports/clock";
import type { IdPort } from "@/src/ports/id";
import type { Logger } from "@/src/ports/logger";

export type InProcessQueueDeps = {
  logger: Logger;
  idPort: IdPort;
  clock: ClockPort;
};

type NewJob = {
  type: string;
  payload: Record<string, unknown>;
};

export function createQueuedJobRecord(
  job: NewJob,
  id: string,
  position: number,
  now: Date,
): JobRecord {
  return {
    id,
    type: job.type,
    payload: job.payload,
    status: "queued",
    position,
    progressPct: 0,
    progressMessage: "",
    checkpoint: null,
    error: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    updatedAt: now,
  };
}

export function hasQueuedJob(jobs: Map<string, JobRecord>): boolean {
  return Array.from(jobs.values()).some((job) => job.status === "queued");
}

export function nextPosition(jobs: Map<string, JobRecord>): number {
  return (
    Array.from(jobs.values()).reduce(
      (max, job) => Math.max(max, job.position),
      -1,
    ) + 1
  );
}

export function findNextQueued(
  jobs: Map<string, JobRecord>,
): JobRecord | null {
  let next: JobRecord | null = null;
  for (const job of jobs.values()) {
    if (
      job.status === "queued" &&
      (!next || job.position < next.position)
    ) {
      next = job;
    }
  }
  return next;
}

function orderedControllableJobs(
  jobs: Map<string, JobRecord>,
): JobRecord[] {
  return Array.from(jobs.values())
    .filter((job) => job.status === "queued" || job.status === "paused")
    .sort((left, right) => left.position - right.position);
}

export function applyOrder(
  jobs: Map<string, JobRecord>,
  orderedIds: string[],
  touch: (job: JobRecord) => void,
): void {
  const controllableJobs = orderedControllableJobs(jobs);
  const expectedIds = new Set(controllableJobs.map((job) => job.id));
  const suppliedIds = new Set(orderedIds);
  if (
    suppliedIds.size !== orderedIds.length ||
    suppliedIds.size !== expectedIds.size ||
    orderedIds.some((id) => !expectedIds.has(id))
  ) {
    throw new Error(
      "orderedIds must exactly match the current queued and paused jobs",
    );
  }
  orderedIds.forEach((id, position) => {
    const job = jobs.get(id);
    if (job) {
      job.position = position;
      touch(job);
    }
  });
}

export function movedOrder(
  jobs: Map<string, JobRecord>,
  jobId: string,
  to: "top" | "bottom",
): string[] {
  const orderedIds = orderedControllableJobs(jobs).map((job) => job.id);
  const currentIndex = orderedIds.indexOf(jobId);
  if (currentIndex < 0) {
    throw new Error("Only queued or paused jobs can be moved");
  }
  orderedIds.splice(currentIndex, 1);
  if (to === "top") {
    orderedIds.unshift(jobId);
  } else {
    orderedIds.push(jobId);
  }
  return orderedIds;
}

export function recoverRunningJobs(
  jobs: Map<string, JobRecord>,
  pauseRequests: Set<string>,
  abortControllers: Map<string, AbortController>,
  touch: (job: JobRecord) => void,
): number {
  let requeuedRunning = 0;
  for (const job of jobs.values()) {
    if (job.status !== "running") {
      continue;
    }
    job.status = "queued";
    pauseRequests.delete(job.id);
    abortControllers.delete(job.id);
    touch(job);
    requeuedRunning += 1;
  }
  return requeuedRunning;
}
