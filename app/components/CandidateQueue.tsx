import Link from "next/link";

export type CandidateQueueItem = {
  id: string;
  origin: "clip" | "generate" | "replay";
  status: string;
  title: string;
  score: number;
  sourceHint: string;
};

function originLabel(origin: CandidateQueueItem["origin"]): string {
  if (origin === "clip") return "CLIP";
  if (origin === "replay") return "REPLAY";
  return "GEN";
}

export function CandidateQueue({
  candidates,
}: {
  candidates: CandidateQueueItem[];
}) {
  if (candidates.length === 0) {
    return (
      <section className="empty-panel">
        <span className="stripe-mark" aria-hidden="true" />
        <h2>Queue clear</h2>
        <p>No candidates match these filters.</p>
      </section>
    );
  }

  return (
    <div className="queue-list">
      {candidates.map((candidate) => (
        <Link
          className="candidate-row"
          href={`/candidates/${candidate.id}`}
          key={candidate.id}
        >
          <div className="candidate-poster" aria-hidden="true">
            <span>{originLabel(candidate.origin)}</span>
          </div>
          <div className="candidate-copy">
            <div className="chip-row">
              <span className={`chip origin-${candidate.origin}`}>
                {originLabel(candidate.origin)}
              </span>
              <span className={`chip status-${candidate.status}`}>
                {candidate.status}
              </span>
            </div>
            <h2>{candidate.title}</h2>
            <p>{candidate.sourceHint}</p>
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
