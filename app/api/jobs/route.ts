import { NextResponse } from "next/server";

import { getContainer } from "@/src/lib/container";

export async function GET() {
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
      progressPct: job.progressPct,
      message: job.progressMessage,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    }));
  return NextResponse.json({ jobs });
}
