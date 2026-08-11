"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

export type JobView = {
  id: string;
  type: string;
  candidateId: string | null;
  status: string;
  checkpointStep: string | null;
  position: number;
  progressPct: number;
  message: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type JobAction = "pause" | "resume" | "cancel" | "top" | "bottom";
type JobPayload = Omit<JobView, "progressPct"> & {
  progressPct?: number;
  pct?: number;
};

const POLLED_STATUSES = new Set(["queued", "running", "paused"]);
const REORDERABLE_STATUSES = new Set(["queued", "paused"]);

export function normalizeJob(job: JobPayload): JobView {
  return {
    ...job,
    progressPct:
      typeof job.progressPct === "number"
        ? job.progressPct
        : typeof job.pct === "number"
          ? job.pct
          : 0,
  };
}

export function jobActionsFor(status: string): JobAction[] {
  if (status === "running") return ["pause", "cancel"];
  if (status === "paused") return ["resume", "cancel", "top", "bottom"];
  if (status === "queued") return ["cancel", "top", "bottom"];
  return [];
}

export function reorderJobIds(
  jobs: JobView[],
  draggedId: string,
  targetId: string,
): string[] {
  const orderedIds = jobs
    .filter((job) => REORDERABLE_STATUSES.has(job.status))
    .sort((left, right) => left.position - right.position)
    .map((job) => job.id);
  const draggedIndex = orderedIds.indexOf(draggedId);
  const targetIndex = orderedIds.indexOf(targetId);
  if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
    return orderedIds;
  }

  orderedIds.splice(draggedIndex, 1);
  orderedIds.splice(orderedIds.indexOf(targetId), 0, draggedId);
  return orderedIds;
}

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
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [draggedJobId, setDraggedJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shouldPoll = jobs.some((job) => POLLED_STATUSES.has(job.status));

  const refreshJobs = useCallback(async () => {
    const response = await fetch("/api/jobs", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Jobs refresh failed (${response.status})`);
    }
    const payload = (await response.json()) as { jobs: JobPayload[] };
    setJobs(payload.jobs.map(normalizeJob));
    setError(null);
  }, []);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    async function poll() {
      try {
        await refreshJobs();
      } catch (pollError) {
        if (active) {
          setError(
            pollError instanceof Error ? pollError.message : "Jobs refresh failed",
          );
        }
      } finally {
        if (active) timer = window.setTimeout(poll, 2000);
      }
    }

    if (!shouldPoll) return;
    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refreshJobs, shouldPoll]);

  async function postAction(jobId: string, action: JobAction) {
    setPendingJobId(jobId);
    setError(null);
    try {
      const isMove = action === "top" || action === "bottom";
      const response = await fetch(
        isMove ? `/api/jobs/${jobId}/move` : `/api/jobs/${jobId}/${action}`,
        {
          method: "POST",
          headers: isMove ? { "Content-Type": "application/json" } : undefined,
          body: isMove ? JSON.stringify({ to: action }) : undefined,
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? `${action} failed (${response.status})`);
      }
      await refreshJobs();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : `${action} failed`,
      );
    } finally {
      setPendingJobId(null);
    }
  }

  async function reorder(draggedId: string, targetId: string) {
    const orderedIds = reorderJobIds(jobs, draggedId, targetId);

    setPendingJobId(draggedId);
    setError(null);
    try {
      const response = await fetch("/api/jobs/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? `Reorder failed (${response.status})`);
      }
      await refreshJobs();
    } catch (reorderError) {
      setError(
        reorderError instanceof Error ? reorderError.message : "Reorder failed",
      );
    } finally {
      setPendingJobId(null);
      setDraggedJobId(null);
    }
  }

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
      {error ? (
        <p className="job-error" role="alert">
          {error}
        </p>
      ) : null}
      {jobs.map((job) => {
        const reorderable = REORDERABLE_STATUSES.has(job.status);
        return (
        <article
          className={`job-card${draggedJobId === job.id ? " is-dragging" : ""}`}
          key={job.id}
          draggable={reorderable}
          onDragStart={(event) => {
            if (!reorderable) return;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", job.id);
            setDraggedJobId(job.id);
          }}
          onDragEnd={() => setDraggedJobId(null)}
          onDragOver={(event) => {
            if (reorderable && draggedJobId && draggedJobId !== job.id) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            const draggedId =
              draggedJobId || event.dataTransfer.getData("text/plain");
            if (reorderable && draggedId && draggedId !== job.id) {
              void reorder(draggedId, job.id);
            }
          }}
        >
          <div className="job-heading">
            <div>
              <p className="eyebrow">{job.type.replaceAll("_", " ")}</p>
              <h2>{job.message || "Waiting for worker"}</h2>
              {job.checkpointStep ? (
                <p className="job-checkpoint">
                  {job.status} @ {job.checkpointStep}
                </p>
              ) : null}
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
          {jobActionsFor(job.status).length > 0 ? (
            <div className="job-actions" aria-label={`Controls for ${job.type}`}>
              {jobActionsFor(job.status).map((action) => (
                <button
                  className="job-action"
                  disabled={pendingJobId === job.id}
                  key={action}
                  onClick={() => void postAction(job.id, action)}
                  type="button"
                >
                  {action}
                </button>
              ))}
            </div>
          ) : null}
        </article>
        );
      })}
    </div>
  );
}
