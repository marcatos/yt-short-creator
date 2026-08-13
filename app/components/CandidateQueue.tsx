"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { formatListDateTime } from "@/app/lib/format";

export type CandidateQueueItem = {
  id: string;
  origin: "clip" | "generate" | "replay";
  status: string;
  title: string;
  score: number;
  sourceHint: string;
  createdAt: string;
  endedAt: string | null;
  previewUrl: string;
};

const INBOX_STATUSES = new Set(["proposed", "revising"]);
const HIDE_ELABORATI_KEY = "candidates.hideElaborati";

function originLabel(origin: CandidateQueueItem["origin"]): string {
  if (origin === "clip") return "CLIP";
  if (origin === "replay") return "REPLAY";
  return "GEN";
}

function readHideElaborati(): boolean {
  if (typeof window === "undefined") return true;
  const stored = window.localStorage.getItem(HIDE_ELABORATI_KEY);
  if (stored === null) return true;
  return stored === "1";
}

export function CandidateQueue({
  candidates,
}: {
  candidates: CandidateQueueItem[];
}) {
  const [hideElaborati, setHideElaborati] = useState(true);

  useEffect(() => {
    setHideElaborati(readHideElaborati());
  }, []);

  const visible = useMemo(
    () =>
      hideElaborati
        ? candidates.filter((candidate) => INBOX_STATUSES.has(candidate.status))
        : candidates,
    [candidates, hideElaborati],
  );

  function toggleHideElaborati() {
    setHideElaborati((current) => {
      const next = !current;
      window.localStorage.setItem(HIDE_ELABORATI_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <div className="queue-list">
      <div className="list-toolbar">
        <label className="list-toggle">
          <input
            checked={hideElaborati}
            onChange={toggleHideElaborati}
            type="checkbox"
          />
          Nascondi elaborati
        </label>
        <span className="list-toolbar-meta">
          {visible.length} / {candidates.length} mostrati
        </span>
      </div>
      {candidates.length === 0 ? (
        <section className="empty-panel">
          <span className="stripe-mark" aria-hidden="true" />
          <h2>Queue clear</h2>
          <p>No candidates match these filters.</p>
        </section>
      ) : null}
      {candidates.length > 0 && visible.length === 0 ? (
        <section className="empty-panel compact-empty">
          <h2>Inbox vuota</h2>
          <p>
            Nessun candidate in triage. Disattiva “Nascondi elaborati” per vedere
            il resto.
          </p>
        </section>
      ) : null}
      {visible.map((candidate) => (
        <Link
          className="candidate-row compact-row"
          href={`/candidates/${candidate.id}`}
          key={candidate.id}
        >
          <div className="compact-thumb" aria-hidden="true">
            <video
              muted
              playsInline
              preload="metadata"
              src={candidate.previewUrl}
            />
          </div>
          <div className="candidate-copy compact-copy">
            <div className="chip-row">
              <span className={`chip origin-${candidate.origin}`}>
                {originLabel(candidate.origin)}
              </span>
              <span className={`chip status-${candidate.status}`}>
                {candidate.status}
              </span>
            </div>
            <h2 className="compact-title">{candidate.title}</h2>
            <p>{candidate.sourceHint}</p>
            <div className="compact-dates">
              <span>
                Creato <strong>{formatListDateTime(candidate.createdAt)}</strong>
              </span>
              <span>
                Fine{" "}
                <strong>{formatListDateTime(candidate.endedAt)}</strong>
              </span>
            </div>
          </div>
          <div className="score-block">
            <strong>{Math.round(candidate.score * 100)}</strong>
            <span>score</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
