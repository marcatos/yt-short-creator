import { NextResponse } from "next/server";

import { presentJobList } from "@/src/application/present-job-list";
import { getContainer } from "@/src/lib/container";

async function loadTitleByCandidateId(
  candidateIds: string[],
): Promise<Map<string, string>> {
  const candidates =
    await getContainer().repositories.candidates.listByIds(candidateIds);
  return new Map(candidates.map((candidate) => [candidate.id, candidate.title]));
}

export async function GET() {
  // listJobs() returns all active (queued/running/paused) jobs plus only the
  // most recent terminal jobs (see TERMINAL_JOB_DISPLAY_LIMIT), so this
  // response stays bounded regardless of how much job history accumulates.
  const jobs = getContainer().jobQueue.listJobs();
  const candidateIds = jobs.flatMap((job) => {
    const id = job.payload.candidateId;
    return typeof id === "string" ? [id] : [];
  });
  const titleByCandidateId = await loadTitleByCandidateId(candidateIds);
  return NextResponse.json({
    jobs: presentJobList(jobs, titleByCandidateId),
  });
}
