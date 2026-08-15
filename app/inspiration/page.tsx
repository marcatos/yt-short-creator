import { InspirationSyncButton } from "@/app/components/InspirationSyncButton";
import { PageHeader } from "@/app/components/PageHeader";
import { formatListDateTime } from "@/app/lib/format";
import { parseInspirationConfig } from "@/src/domain/inspiration-config";
import { getContainer } from "@/src/lib/container";
import type {
  InspirationIdeaRecord,
  InspirationSyncRun,
} from "@/src/ports/inspiration-store";

export const dynamic = "force-dynamic";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isStale(
  latestSuccessfulSyncAt: Date | null,
  now: Date,
  staleDays: number,
): boolean {
  if (!latestSuccessfulSyncAt) return true;
  return now.getTime() - latestSuccessfulSyncAt.getTime() > staleDays * MS_PER_DAY;
}

function formatRelatedInterest(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (Array.isArray(value)) {
    const items = value.map(String).filter(Boolean);
    return items.length > 0 ? items.join(", ") : null;
  }
  if (typeof value === "object") {
    const record = value as { items?: unknown; raw?: unknown };
    if (Array.isArray(record.items)) {
      const items = record.items.map(String).filter(Boolean);
      if (items.length > 0) return items.join(", ");
    }
    if (typeof record.raw === "string" && record.raw.trim()) {
      return record.raw;
    }
  }
  return null;
}

export default async function InspirationPage() {
  const store = getContainer().repositories.inspiration;
  const config = parseInspirationConfig(process.env);
  const [ideas, syncRuns, latestSuccessfulSyncAt] = await Promise.all([
    store.listActiveIdeas(),
    store.listSyncRuns(20),
    store.getLatestSuccessfulSyncAt(),
  ]);
  const stale = isStale(
    latestSuccessfulSyncAt,
    new Date(),
    config.staleDays,
  );

  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="YouTube Studio"
        title="Inspiration"
        description="Mirror Studio Inspiration ideas into the Shorts desk."
        actions={
          <div className="list-toolbar library-toolbar">
            {stale ? <span className="chip chip-stale">Stale</span> : null}
            <InspirationSyncButton />
          </div>
        }
      />

      <section className="inspiration-list" aria-label="Active ideas">
        {ideas.length === 0 ? (
          <section className="empty-panel">
            <span className="stripe-mark" aria-hidden="true" />
            <h2>No active ideas</h2>
            <p>Sync YouTube Studio Inspiration to populate this board.</p>
          </section>
        ) : (
          ideas.map((idea) => <IdeaRow idea={idea} key={idea.id} />)
        )}
      </section>

      <section aria-label="Sync history">
        <h2 className="inspiration-history-heading">Sync history</h2>
        {syncRuns.length === 0 ? (
          <p className="muted">No sync runs yet.</p>
        ) : (
          <div className="history-table-wrap">
            <SyncHistoryTable runs={syncRuns} />
          </div>
        )}
      </section>
    </main>
  );
}

function IdeaRow({ idea }: { idea: InspirationIdeaRecord }) {
  const related = formatRelatedInterest(idea.relatedInterest);
  const hasDetails = Boolean(idea.outline || related || idea.thumbnailNotes);

  return (
    <article className="compact-row inspiration-row">
      <div className="compact-copy">
        <div className="chip-row">
          {idea.audienceInterest ? (
            <span className="chip">{idea.audienceInterest}</span>
          ) : null}
          {idea.channelAlignment ? (
            <span className="chip">{idea.channelAlignment}</span>
          ) : null}
        </div>
        <h2 className="compact-title">{idea.title}</h2>
        <p className="muted">{idea.summary}</p>
        {idea.suggestedTitles.length > 0 ? (
          <ul className="inspiration-suggested">
            {idea.suggestedTitles.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        ) : null}
        {hasDetails ? (
          <details>
            <summary>Details</summary>
            {idea.outline ? (
              <p>
                <strong>Outline.</strong> {idea.outline}
              </p>
            ) : null}
            {related ? (
              <p>
                <strong>Related.</strong> {related}
              </p>
            ) : null}
            {idea.thumbnailNotes ? (
              <p>
                <strong>Thumbnail.</strong> {idea.thumbnailNotes}
              </p>
            ) : null}
          </details>
        ) : null}
      </div>
    </article>
  );
}

function SyncHistoryTable({ runs }: { runs: InspirationSyncRun[] }) {
  return (
    <table className="history-table">
      <thead>
        <tr>
          <th>Status</th>
          <th>Ideas</th>
          <th>Source</th>
          <th>Started</th>
          <th>Finished</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id}>
            <td>
              <span className={`chip status-${run.status}`}>{run.status}</span>
            </td>
            <td>{run.ideaCount}</td>
            <td>{run.source}</td>
            <td>{formatListDateTime(run.startedAt)}</td>
            <td>{formatListDateTime(run.finishedAt)}</td>
            <td>{run.errorMessage ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
