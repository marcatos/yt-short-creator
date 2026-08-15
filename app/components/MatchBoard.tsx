"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";

import { formatCompactCount } from "@/app/lib/format";

export type MatchVideoOption = {
  id: string;
  title: string;
  durationSec: number;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
};

export type MatchIdeaOption = {
  id: string;
  title: string;
  summary: string;
  audienceInterest: string | null;
  channelAlignment: string | null;
};

export type MatchPairRow = {
  sourceVideoId: string;
  ideaId: string;
  pairScore: number;
  align: number;
  studio: number;
  analytics: number;
  fresh: number;
};

type MatchBoardProps = {
  channelId: string;
  videos: MatchVideoOption[];
  ideas: MatchIdeaOption[];
  inspirationStale: boolean;
};

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function scorePct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function MatchBoard({
  channelId,
  videos,
  ideas,
  inspirationStale,
}: MatchBoardProps) {
  const [selectedVideos, setSelectedVideos] = useState<Record<string, boolean>>(
    {},
  );
  const [selectedIdeas, setSelectedIdeas] = useState<Record<string, boolean>>(
    {},
  );
  const [k, setK] = useState(5);
  const [pairs, setPairs] = useState<MatchPairRow[]>([]);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [isPreviewing, startPreview] = useTransition();
  const [isRunning, startRun] = useTransition();

  const videoIds = useMemo(
    () => Object.keys(selectedVideos).filter((id) => selectedVideos[id]),
    [selectedVideos],
  );
  const ideaIds = useMemo(
    () => Object.keys(selectedIdeas).filter((id) => selectedIdeas[id]),
    [selectedIdeas],
  );

  const videoTitleById = useMemo(
    () => Object.fromEntries(videos.map((video) => [video.id, video.title])),
    [videos],
  );
  const ideaTitleById = useMemo(
    () => Object.fromEntries(ideas.map((idea) => [idea.id, idea.title])),
    [ideas],
  );

  const acceptedPairs = useMemo(
    () =>
      pairs.filter(
        (pair) => accepted[`${pair.sourceVideoId}:${pair.ideaId}`] !== false,
      ),
    [pairs, accepted],
  );

  const canPreview = videoIds.length > 0 && ideaIds.length > 0;
  const canRun = canPreview && acceptedPairs.length > 0;

  function pairKey(pair: MatchPairRow): string {
    return `${pair.sourceVideoId}:${pair.ideaId}`;
  }

  function toggleVideo(id: string) {
    setSelectedVideos((current) => ({ ...current, [id]: !current[id] }));
  }

  function toggleIdea(id: string) {
    setSelectedIdeas((current) => ({ ...current, [id]: !current[id] }));
  }

  function toggleAllVideos(on: boolean) {
    setSelectedVideos(
      Object.fromEntries(videos.map((video) => [video.id, on])),
    );
  }

  function toggleAllIdeas(on: boolean) {
    setSelectedIdeas(Object.fromEntries(ideas.map((idea) => [idea.id, on])));
  }

  function runPreview() {
    if (!canPreview) return;
    setPreviewError(null);
    startPreview(async () => {
      try {
        const response = await fetch("/api/match/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceVideoIds: videoIds,
            ideaIds,
            k,
          }),
        });
        const body = (await response.json()) as {
          error?: string;
          pairs?: MatchPairRow[];
        };
        if (!response.ok) {
          setPairs([]);
          setAccepted({});
          setPreviewError(body.error ?? "Preview failed");
          return;
        }
        const nextPairs = body.pairs ?? [];
        setPairs(nextPairs);
        setAccepted(
          Object.fromEntries(
            nextPairs.map((pair) => [pairKey(pair), true]),
          ),
        );
      } catch {
        setPreviewError("Preview request failed");
      }
    });
  }

  function runMatch() {
    if (!canRun) return;
    setRunError(null);
    setJobId(null);
    startRun(async () => {
      try {
        const response = await fetch("/api/match/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channelId,
            pairs: acceptedPairs.map((pair) => ({
              sourceVideoId: pair.sourceVideoId,
              ideaId: pair.ideaId,
            })),
          }),
        });
        const body = (await response.json()) as {
          error?: string;
          jobId?: string;
        };
        if (!response.ok) {
          setRunError(body.error ?? "Run failed");
          return;
        }
        setJobId(body.jobId ?? null);
      } catch {
        setRunError("Run request failed");
      }
    });
  }

  useEffect(() => {
    setPairs([]);
    setAccepted({});
    setJobId(null);
  }, [videoIds.join("|"), ideaIds.join("|"), k]);

  return (
    <div className="match-board">
      {inspirationStale ? (
        <p className="match-stale-note muted">
          Inspiration mirror is stale — Run still allowed; selected ideas bypass
          the stale gate for bias.
        </p>
      ) : null}

      <div className="match-pickers">
        <section className="match-picker" aria-label="Library videos">
          <div className="match-picker-header">
            <h2>Videos</h2>
            <div className="match-picker-actions">
              <button
                className="button button-ghost"
                type="button"
                onClick={() => toggleAllVideos(true)}
              >
                All
              </button>
              <button
                className="button button-ghost"
                type="button"
                onClick={() => toggleAllVideos(false)}
              >
                None
              </button>
            </div>
          </div>
          <ul className="match-option-list">
            {videos.map((video) => (
              <li key={video.id}>
                <label className="match-option">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedVideos[video.id])}
                    onChange={() => toggleVideo(video.id)}
                  />
                  <span className="match-option-copy">
                    <strong>{video.title}</strong>
                    <span className="muted">
                      {formatDuration(video.durationSec)} ·{" "}
                      {formatCompactCount(video.viewCount)} views ·{" "}
                      {formatCompactCount(video.likeCount)} likes
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section className="match-picker" aria-label="Inspiration ideas">
          <div className="match-picker-header">
            <h2>Ideas</h2>
            <div className="match-picker-actions">
              <button
                className="button button-ghost"
                type="button"
                onClick={() => toggleAllIdeas(true)}
              >
                All
              </button>
              <button
                className="button button-ghost"
                type="button"
                onClick={() => toggleAllIdeas(false)}
              >
                None
              </button>
            </div>
          </div>
          <ul className="match-option-list">
            {ideas.map((idea) => (
              <li key={idea.id}>
                <label className="match-option">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedIdeas[idea.id])}
                    onChange={() => toggleIdea(idea.id)}
                  />
                  <span className="match-option-copy">
                    <strong>{idea.title}</strong>
                    <span className="muted">
                      {[idea.audienceInterest, idea.channelAlignment]
                        .filter(Boolean)
                        .join(" · ") || idea.summary.slice(0, 80)}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="filter-bar match-controls">
        <label>
          Top K
          <input
            aria-label="Top K pairs"
            type="number"
            min={1}
            max={50}
            value={k}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) setK(Math.min(50, Math.max(1, next)));
            }}
          />
        </label>
        <button
          className="button button-secondary"
          type="button"
          disabled={!canPreview || isPreviewing}
          onClick={runPreview}
        >
          {isPreviewing ? "Ranking…" : "Preview pairs"}
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={!canRun || isRunning}
          onClick={runMatch}
        >
          {isRunning ? "Queuing…" : "Run match"}
        </button>
        <span className="list-toolbar-meta">
          {videoIds.length} videos · {ideaIds.length} ideas ·{" "}
          {acceptedPairs.length} pairs
        </span>
      </div>

      {previewError ? <p className="match-error">{previewError}</p> : null}
      {runError ? <p className="match-error">{runError}</p> : null}
      {jobId ? (
        <p className="match-queued">
          Queued job <code>{jobId}</code> —{" "}
          <Link href="/jobs">Open Jobs</Link> ·{" "}
          <Link href="/candidates">Candidates</Link>
        </p>
      ) : null}

      {pairs.length > 0 ? (
        <section className="match-pairs" aria-label="Ranked pairs">
          <div className="history-table-wrap">
            <table className="history-table match-pair-table">
              <thead>
                <tr>
                  <th scope="col">Use</th>
                  <th scope="col">Video</th>
                  <th scope="col">Idea</th>
                  <th scope="col">Score</th>
                  <th scope="col">Align</th>
                  <th scope="col">Studio</th>
                  <th scope="col">Analytics</th>
                  <th scope="col">Fresh</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((pair) => {
                  const key = pairKey(pair);
                  return (
                    <tr key={key}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Accept pair ${key}`}
                          checked={accepted[key] !== false}
                          onChange={() =>
                            setAccepted((current) => ({
                              ...current,
                              [key]: !(current[key] !== false),
                            }))
                          }
                        />
                      </td>
                      <td>{videoTitleById[pair.sourceVideoId] ?? pair.sourceVideoId}</td>
                      <td>{ideaTitleById[pair.ideaId] ?? pair.ideaId}</td>
                      <td>
                        <strong>{scorePct(pair.pairScore)}</strong>
                      </td>
                      <td>{scorePct(pair.align)}</td>
                      <td>{scorePct(pair.studio)}</td>
                      <td>{scorePct(pair.analytics)}</td>
                      <td>{scorePct(pair.fresh)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <p className="muted match-empty-hint">
          Select at least one video and one idea, then Preview pairs.
        </p>
      )}
    </div>
  );
}
