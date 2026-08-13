import { JobProgress } from "@/app/components/JobProgress";
import { presentJobList } from "@/src/application/present-job-list";
import { getContainer } from "@/src/lib/container";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const container = getContainer();
  const jobs = container.jobQueue.listJobs();
  const candidateIds = jobs.flatMap((job) => {
    const id = job.payload.candidateId;
    return typeof id === "string" ? [id] : [];
  });
  const candidates =
    await container.repositories.candidates.listByIds(candidateIds);
  const titleByCandidateId = new Map(
    candidates.map((candidate) => [candidate.id, candidate.title]),
  );

  return (
    <main className="page-shell">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Worker telemetry</p>
          <h1>Render + publish jobs</h1>
        </div>
        <span className="live-indicator">Live polling</span>
      </header>
      <JobProgress initialJobs={presentJobList(jobs, titleByCandidateId)} />
    </main>
  );
}
