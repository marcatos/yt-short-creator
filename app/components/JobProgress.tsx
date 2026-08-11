"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export type JobView = {
  id: string;
  type: string;
  candidateId: string | null;
  status: string;
  progressPct: number;
  message: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

function duration(job: JobView): string {
  if (!job.startedAt) return "Waiting";
  const end = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now();
  return `${Math.max(0, Math.round((end - new Date(job.startedAt).getTime()) / 1000))}s`;
}

function eta(job: JobView): string | null {
  if (!job.startedAt || job.progressPct <= 0 || job.progressPct >= 100) return null;
  const elapsed = Date.now() - new Date(job.startedAt).getTime();
  const remaining = elapsed * ((100 - job.progressPct) / job.progressPct);
  return `${Math.max(1, Math.round(remaining / 1000))}s ETA`;
}

export function JobProgress({ initialJobs }: { initialJobs: JobView[] }) {
  const [jobs, setJobs] = useState(initialJobs);

  useEffect(() => {
    let active = true;
    let currentJobs = initialJobs;
    async function poll() {
      if (!currentJobs.some((job) => ["queued", "running"].includes(job.status))) {
        return;
      }
      try {
        const updated = await Promise.all(
          currentJobs.map(async (job) => {
            if (!["queued", "running"].includes(job.status)) return job;
            const response = await fetch(`/api/jobs/${job.id}/progress`, {
              cache: "no-store",
            });
            if (!response.ok) return job;
            const progress = await response.json();
            return { ...job, ...progress };
          }),
        );
        if (active) {
          currentJobs = updated;
          setJobs(updated);
        }
      } catch {
        // Preserve the last known state during a transient polling failure.
      }
    }
    void poll();
    const timer = window.setInterval(poll, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (jobs.length === 0) {
    return (
      <section className="empty-panel">
        <span className="stripe-mark" aria-hidden="true" />
        <h2>No jobs yet</h2>
        <p>Approved candidates will appear here while rendering and publishing.</p>
      </section>
    );
  }

  return (
    <div className="jobs-list">
      {jobs.map((job) => (
        <article className="job-card" key={job.id}>
          <div className="job-heading">
            <div>
              <p className="eyebrow">{job.type.replaceAll("_", " ")}</p>
              <h2>{job.message || "Waiting for worker"}</h2>
            </div>
            <span className={`chip status-${job.status}`}>{job.status}</span>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-valuenow={job.progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${job.type} progress`}
          >
            <span style={{ width: `${job.progressPct}%` }} />
          </div>
          <div className="job-meta">
            <strong>{job.progressPct}%</strong>
            <span>{duration(job)}</span>
            {eta(job) ? <span>{eta(job)}</span> : null}
            {job.candidateId ? (
              <Link href={`/candidates/${job.candidateId}`}>Candidate</Link>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
