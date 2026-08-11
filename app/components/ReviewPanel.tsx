"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type CandidateReview = {
  id: string;
  origin: "clip" | "generate" | "replay";
  status: string;
  title: string;
  description: string;
  tags: string[];
  score: number;
  scheduledAt: string | null;
  renderOutputPath: string | null;
  provenance: Record<string, unknown>;
};

function localDateTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function ReviewPanel({ candidate }: { candidate: CandidateReview }) {
  const router = useRouter();
  const [title, setTitle] = useState(candidate.title);
  const [description, setDescription] = useState(candidate.description);
  const [tags, setTags] = useState(candidate.tags.join(", "));
  const [scheduledAt, setScheduledAt] = useState(
    localDateTime(candidate.scheduledAt),
  );
  const [revisionNote, setRevisionNote] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const editable = ["proposed", "revising"].includes(candidate.status);

  async function saveMetadata() {
    const response = await fetch(`/api/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        scheduledAt: scheduledAt
          ? new Date(scheduledAt).toISOString()
          : null,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to save metadata");
  }

  async function runAction(action: "approve" | "reject" | "revise") {
    setPending(true);
    setMessage("");
    try {
      if (action === "approve") await saveMetadata();
      const response = await fetch(
        `/api/candidates/${candidate.id}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: action === "revise" ? JSON.stringify({ note: revisionNote }) : "{}",
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Unable to ${action}`);
      setMessage(
        action === "approve"
          ? "Approved. Render job queued."
          : action === "reject"
            ? "Candidate rejected."
            : "Revision requested.",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed");
    } finally {
      setPending(false);
    }
  }

  const timedOrigin =
    candidate.origin === "clip" || candidate.origin === "replay";
  const clipStart =
    timedOrigin && typeof candidate.provenance.startMs === "number"
      ? candidate.provenance.startMs / 1000
      : null;
  const clipEnd =
    timedOrigin && typeof candidate.provenance.endMs === "number"
      ? candidate.provenance.endMs / 1000
      : null;
  const mediaFragment =
    clipStart !== null && clipEnd !== null && !candidate.renderOutputPath
      ? `#t=${clipStart},${clipEnd}`
      : "";

  return (
    <div className="review-grid">
      <section className="preview-column">
        <div className="vertical-preview">
          {previewUnavailable ? (
            <div className="preview-fallback">
              <span className="stripe-mark" aria-hidden="true" />
              <strong>Preview pending</strong>
              <small>Approve to start the final 9:16 render.</small>
            </div>
          ) : (
            <video
              controls
              playsInline
              preload="metadata"
              src={`/api/candidates/${candidate.id}/media${mediaFragment}`}
              onError={() => setPreviewUnavailable(true)}
            />
          )}
        </div>
        <div className="provenance-panel">
          <p className="eyebrow">Provenance</p>
          {candidate.origin === "clip" || candidate.origin === "replay" ? (
            <>
              <strong>
                {clipStart?.toFixed(1)}s — {clipEnd?.toFixed(1)}s
              </strong>
              <p>{String(candidate.provenance.hookReason ?? "Selected moment")}</p>
              {candidate.origin === "replay" ? (
                <p>
                  Event {String(candidate.provenance.eventType ?? "moment")} ·
                  session{" "}
                  {String(candidate.provenance.replaySessionId ?? "unknown")}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <strong>
                Script version {String(candidate.provenance.scriptVersion ?? 1)}
              </strong>
              <p>
                Brief {String(candidate.provenance.generationBriefId ?? "pending")}
              </p>
            </>
          )}
        </div>
      </section>

      <section className="review-form">
        <div className="review-heading">
          <div>
            <p className="eyebrow">{candidate.origin} candidate</p>
            <h1>Decision surface</h1>
          </div>
          <span className={`chip status-${candidate.status}`}>
            {candidate.status}
          </span>
        </div>
        <label>
          Title
          <input
            maxLength={100}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={!editable}
          />
        </label>
        <label>
          Description
          <textarea
            rows={6}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={!editable}
          />
        </label>
        <label>
          Tags <span>comma separated</span>
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            disabled={!editable}
          />
        </label>
        <label>
          Optional schedule
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
            disabled={!editable}
          />
        </label>
        <label>
          Revision note
          <textarea
            rows={3}
            placeholder="What should the worker change?"
            value={revisionNote}
            onChange={(event) => setRevisionNote(event.target.value)}
            disabled={!editable}
          />
        </label>
        <div className="action-row">
          <button
            className="button button-primary"
            disabled={pending || candidate.status !== "proposed"}
            onClick={() => runAction("approve")}
          >
            Approve
          </button>
          <button
            className="button button-secondary"
            disabled={pending || candidate.status !== "proposed"}
            onClick={() => runAction("reject")}
          >
            Reject
          </button>
          <button
            className="button button-ghost"
            disabled={pending || !editable || !revisionNote.trim()}
            onClick={() => runAction("revise")}
          >
            Revise
          </button>
        </div>
        <p className="form-status" aria-live="polite">
          {pending ? "Working…" : message}
        </p>
      </section>
    </div>
  );
}
