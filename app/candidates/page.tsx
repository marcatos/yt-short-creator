import { CandidateQueue } from "@/app/components/CandidateQueue";
import { PageHeader } from "@/app/components/PageHeader";
import { CANDIDATE_STATUSES } from "@/src/domain/status";
import { getContainer } from "@/src/lib/container";
import type {
  CandidateInspirationLink,
  InspirationIdeaRecord,
} from "@/src/ports/inspiration-store";

export const dynamic = "force-dynamic";

const TERMINAL_CANDIDATE_STATUSES = new Set([
  "published",
  "rejected",
  "failed",
]);

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
  const container = getContainer();
  const candidates = await container.listCandidates({ status, origin });
  candidates.sort((left, right) =>
    query.sort === "newest"
      ? right.createdAt.getTime() - left.createdAt.getTime()
      : right.score - left.score,
  );

  const publishJobs =
    await container.repositories.jobs.listPublishJobsByCandidateIds(
      candidates.map((candidate) => candidate.id),
    );
  const publishedAtByCandidateId = new Map(
    publishJobs.map((job) => [job.candidateId, job.publishedAt]),
  );
  const inspirationLinks =
    await container.repositories.inspiration.listLinksForCandidates(
      candidates.map((candidate) => candidate.id),
    );
  const inspirationTitleByIdeaId = new Map<string, string>(
    inspirationLinks.length === 0
      ? []
      : (
          await container.repositories.inspiration.listActiveIdeas()
        ).map((idea: InspirationIdeaRecord) => [idea.id, idea.title]),
  );
  const inspirationTitlesByCandidateId = titlesByCandidateId(
    inspirationLinks,
    inspirationTitleByIdeaId,
  );

  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="Approval queue"
        title="Candidate triage"
        description="Triage proposed Shorts by status, origin, and score."
        actions={<strong>{candidates.length} loaded</strong>}
      />
      <form className="filter-bar is-sticky">
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
        candidates={candidates.map((candidate) => {
          const publishedAt = publishedAtByCandidateId.get(candidate.id);
          const endedAt =
            publishedAt ??
            (TERMINAL_CANDIDATE_STATUSES.has(candidate.status)
              ? candidate.updatedAt
              : null);
          return {
            id: candidate.id,
            origin: candidate.origin,
            status: candidate.status,
            title: candidate.title,
            score: candidate.score,
            createdAt: candidate.createdAt.toISOString(),
            endedAt: endedAt?.toISOString() ?? null,
            previewUrl: `/api/candidates/${candidate.id}/media`,
            inspirationTitles:
              inspirationTitlesByCandidateId.get(candidate.id),
            sourceHint:
              candidate.origin === "clip"
                ? `Source ${"sourceVideoId" in candidate.provenance ? candidate.provenance.sourceVideoId : "video"}`
                : candidate.origin === "replay"
                  ? `Replay ${"replaySessionId" in candidate.provenance ? candidate.provenance.replaySessionId : "session"} · ${"eventType" in candidate.provenance ? candidate.provenance.eventType : "moment"}${"segments" in candidate.provenance && Array.isArray(candidate.provenance.segments) && candidate.provenance.segments.length >= 2 ? ` · multi-scene×${candidate.provenance.segments.length}` : ""}`
                  : `Brief ${"generationBriefId" in candidate.provenance ? candidate.provenance.generationBriefId : "generated"}`,
          };
        })}
      />
    </main>
  );
}

function titlesByCandidateId(
  links: CandidateInspirationLink[],
  titleByIdeaId: Map<string, string>,
): Map<string, string[]> {
  const titles = new Map<string, string[]>();
  for (const link of links) {
    const existing = titles.get(link.candidateId) ?? [];
    const title = titleByIdeaId.get(link.ideaId);
    if (title && !existing.includes(title)) {
      existing.push(title);
    }
    titles.set(link.candidateId, existing);
  }
  for (const [candidateId, list] of titles) {
    if (list.length === 0) {
      titles.set(candidateId, ["Matched idea"]);
    }
  }
  return titles;
}
