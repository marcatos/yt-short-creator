"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { formatListDateTime } from "@/app/lib/format";

export type JobView = {
  id: string;
  type: string;
  candidateId: string | null;
  title: string | null;
  previewUrl: string | null;
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
type JobPayload = Omit<JobView, "progressPct" | "title" | "previewUrl"> & {
  progressPct?: number;
  pct?: number;
  title?: string | null;
  previewUrl?: string | null;
};

const POLLED_STATUSES = new Set(["queued", "running", "paused"]);
const REORDERABLE_STATUSES = new Set(["queued", "paused"]);
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const HIDE_COMPLETED_KEY = "jobs.hideCompleted";

export function normalizeJob(job: JobPayload): JobView {
  return {
    ...job,
    title: job.title ?? null,
    previewUrl: job.previewUrl ?? null,
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

function endDateLabel(job: JobView): { label: string; value: string } {
  if (job.finishedAt) {
    return { label: "Fine", value: formatListDateTime(job.finishedAt) };
  }
  if (job.status === "running" && job.startedAt) {
    return { label: "Avviato", value: formatListDateTime(job.startedAt) };
  }
  return { label: "Fine", value: "—" };
}

function readHideCompleted(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(HIDE_COMPLETED_KEY) === "1";
}

export function JobProgress({ initialJobs }: { initialJobs: JobView[] }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [draggedJobId, setDraggedJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [clearing, setClearing] = useState(false);
  const shouldPoll = jobs.some((job) => POLLED_STATUSES.has(job.status));

  useEffect(() => {
    setHideCompleted(readHideCompleted());
  }, []);

  const visibleJobs = useMemo(
    () =>
      hideCompleted
        ? jobs.filter((job) => !TERMINAL_STATUSES.has(job.status))
        : jobs,
    [hideCompleted, jobs],
  );
  const terminalCount = jobs.filter((job) =>
    TERMINAL_STATUSES.has(job.status),
  ).length;

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

  function toggleHideCompleted() {
    setHideCompleted((current) => {
      const next = !current;
      window.localStorage.setItem(HIDE_COMPLETED_KEY, next ? "1" : "0");
      return next;
    });
  }

  async function clearTerminal() {
    if (
      !window.confirm(
        `Eliminare definitivamente ${terminalCount} job completati/falliti/cancellati dalla coda?`,
      )
    ) {
      return;
    }
    setClearing(true);
    setError(null);
    try {
      const response = await fetch("/api/jobs/clear-terminal", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`Clear failed (${response.status})`);
      }
      await refreshJobs();
    } catch (clearError) {
      setError(
        clearError instanceof Error ? clearError.message : "Clear failed",
      );
    } finally {
      setClearing(false);
    }
  }

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

  return (
    <div className="jobs-list">
      <div className="list-toolbar">
        <label className="list-toggle">
          <input
            checked={hideCompleted}
            onChange={toggleHideCompleted}
            type="checkbox"
          />
          Nascondi completati
        </label>
        <button
          className="button button-secondary"
          disabled={clearing || terminalCount === 0}
          onClick={() => void clearTerminal()}
          type="button"
        >
          {clearing ? "Pulizia…" : `Pulisci coda (${terminalCount})`}
        </button>
      </div>
      {error ? (
        <p className="job-error" role="alert">
          {error}
        </p>
      ) : null}
      {jobs.length === 0 ? (
        <section className="empty-panel">
          <span className="stripe-mark" aria-hidden="true" />
          <h2>No jobs yet</h2>
          <p>
            Approved candidates will appear here while rendering and publishing.
          </p>
        </section>
      ) : null}
      {jobs.length > 0 && visibleJobs.length === 0 ? (
        <section className="empty-panel compact-empty">
          <h2>Coda attiva vuota</h2>
          <p>I job completati sono nascosti. Disattiva il filtro per rivederli.</p>
        </section>
      ) : null}
      {visibleJobs.map((job) => {
        const reorderable = REORDERABLE_STATUSES.has(job.status);
        const end = endDateLabel(job);
        const heading =
          job.title || job.message || "Waiting for worker";
        return (
          <article
            className={`job-card compact-row${draggedJobId === job.id ? " is-dragging" : ""}`}
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
            <div className="compact-thumb" aria-hidden={!job.previewUrl}>
              {job.previewUrl ? (
                <video muted playsInline preload="metadata" src={job.previewUrl} />
              ) : (
                <span className="compact-thumb-fallback">JOB</span>
              )}
            </div>
            <div className="compact-copy">
              <div className="chip-row">
                <span className="chip">{job.type.replaceAll("_", " ")}</span>
                <span className={`chip status-${job.status}`}>{job.status}</span>
              </div>
              <h2 className="compact-title">{heading}</h2>
              <div className="compact-dates">
                <span>
                  Creato <strong>{formatListDateTime(job.createdAt)}</strong>
                </span>
                <span>
                  {end.label} <strong>{end.value}</strong>
                </span>
                <span>{duration(job)}</span>
                {eta(job) ? <span>{eta(job)}</span> : null}
                {job.candidateId ? (
                  <Link href={`/candidates/${job.candidateId}`}>Candidate</Link>
                ) : null}
              </div>
              <div
                className="progress-track compact-progress"
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
                {job.checkpointStep ? (
                  <span>
                    {job.status} @ {job.checkpointStep}
                  </span>
                ) : null}
              </div>
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
            ) : (
              <div className="job-actions" />
            )}
          </article>
        );
      })}
    </div>
  );
}
