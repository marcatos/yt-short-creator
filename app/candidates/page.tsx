import { CandidateQueue } from "@/app/components/CandidateQueue";
import { CANDIDATE_STATUSES } from "@/src/domain/status";
import { getContainer } from "@/src/lib/container";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    status?: string;
    origin?: string;
    sort?: string;
  }>;
};

export default async function CandidatesPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const status = CANDIDATE_STATUSES.includes(
    query.status as (typeof CANDIDATE_STATUSES)[number],
  )
    ? query.status
    : undefined;
  const origin = ["clip", "generate", "replay"].includes(query.origin ?? "")
    ? query.origin
    : undefined;
  const candidates = await getContainer().listCandidates({ status, origin });
  candidates.sort((left, right) =>
    query.sort === "newest"
      ? right.createdAt.getTime() - left.createdAt.getTime()
      : right.score - left.score,
  );

  return (
    <main className="page-shell">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Approval queue</p>
          <h1>Candidate triage</h1>
        </div>
        <strong>{candidates.length} shown</strong>
      </header>
      <form className="filter-bar">
        <label>
          Status
          <select name="status" defaultValue={status ?? ""}>
            <option value="">All statuses</option>
            {CANDIDATE_STATUSES.map((candidateStatus) => (
              <option value={candidateStatus} key={candidateStatus}>
                {candidateStatus}
              </option>
            ))}
          </select>
        </label>
        <label>
          Origin
          <select name="origin" defaultValue={origin ?? ""}>
            <option value="">All origins</option>
            <option value="clip">Clip</option>
            <option value="generate">Generate</option>
            <option value="replay">Replay</option>
          </select>
        </label>
        <label>
          Sort
          <select name="sort" defaultValue={query.sort ?? "score"}>
            <option value="score">Score</option>
            <option value="newest">Newest</option>
          </select>
        </label>
        <button className="button button-secondary" type="submit">
          Apply filters
        </button>
      </form>
      <CandidateQueue
        candidates={candidates.map((candidate) => ({
          id: candidate.id,
          origin: candidate.origin,
          status: candidate.status,
          title: candidate.title,
          score: candidate.score,
          sourceHint:
            candidate.origin === "clip"
              ? `Source ${"sourceVideoId" in candidate.provenance ? candidate.provenance.sourceVideoId : "video"}`
              : candidate.origin === "replay"
                ? `Replay ${"replaySessionId" in candidate.provenance ? candidate.provenance.replaySessionId : "session"} · ${"eventType" in candidate.provenance ? candidate.provenance.eventType : "moment"}`
                : `Brief ${"generationBriefId" in candidate.provenance ? candidate.provenance.generationBriefId : "generated"}`,
        }))}
      />
    </main>
  );
}
