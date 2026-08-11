import { NextResponse } from "next/server";

import { getContainer } from "@/src/lib/container";

export async function GET() {
  // listJobs() returns all active (queued/running/paused) jobs plus only the
  // most recent terminal jobs (see TERMINAL_JOB_DISPLAY_LIMIT), so this
  // response stays bounded regardless of how much job history accumulates.
  const jobs = getContainer()
    .jobQueue.listJobs()
    .map((job) => ({
      id: job.id,
      type: job.type,
      candidateId:
        typeof job.payload.candidateId === "string"
          ? job.payload.candidateId
          : null,
      status: job.status,
      position: job.position,
      progressPct: job.progressPct,
      message: job.progressMessage,
      checkpointStep: job.checkpoint?.step ?? null,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    }));
  return NextResponse.json({ jobs });
}
