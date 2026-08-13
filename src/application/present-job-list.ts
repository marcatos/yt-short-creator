import type { JobRecord } from "@/src/adapters/jobs/job-record";

export type JobListItem = {
  id: string;
  type: string;
  candidateId: string | null;
  title: string | null;
  previewUrl: string | null;
  status: JobRecord["status"];
  checkpointStep: string | null;
  position: number;
  progressPct: number;
  message: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

function candidateIdFromPayload(
  payload: Record<string, unknown>,
): string | null {
  return typeof payload.candidateId === "string" ? payload.candidateId : null;
}

function titleFromPayload(payload: Record<string, unknown>): string | null {
  return typeof payload.title === "string" && payload.title.trim()
    ? payload.title
    : null;
}

export function presentJobListItem(
  job: JobRecord,
  titleByCandidateId: Map<string, string>,
): JobListItem {
  const candidateId = candidateIdFromPayload(job.payload);
  const title =
    (candidateId ? titleByCandidateId.get(candidateId) : null) ??
    titleFromPayload(job.payload);

  return {
    id: job.id,
    type: job.type,
    candidateId,
    title,
    previewUrl: candidateId ? `/api/candidates/${candidateId}/media` : null,
    status: job.status,
    checkpointStep: job.checkpoint?.step ?? null,
    position: job.position,
    progressPct: job.progressPct,
    message: job.progressMessage,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

export function presentJobList(
  jobs: JobRecord[],
  titleByCandidateId: Map<string, string>,
): JobListItem[] {
  return jobs.map((job) => presentJobListItem(job, titleByCandidateId));
}
