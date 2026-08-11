import { JobProgress } from "@/app/components/JobProgress";
import { getContainer } from "@/src/lib/container";

export const dynamic = "force-dynamic";

export default function JobsPage() {
  const jobs = getContainer().jobQueue.listJobs();
  return (
    <main className="page-shell">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Worker telemetry</p>
          <h1>Render + publish jobs</h1>
        </div>
        <span className="live-indicator">Live polling</span>
      </header>
      <JobProgress
        initialJobs={jobs.map((job) => ({
          id: job.id,
          type: job.type,
          candidateId:
            typeof job.payload.candidateId === "string"
              ? job.payload.candidateId
              : null,
          status: job.status,
          progressPct: job.progressPct,
          message: job.progressMessage,
          createdAt: job.createdAt.toISOString(),
          startedAt: job.startedAt?.toISOString() ?? null,
          finishedAt: job.finishedAt?.toISOString() ?? null,
        }))}
      />
    </main>
  );
}
