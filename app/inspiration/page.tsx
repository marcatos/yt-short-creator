import { InspirationBoard } from "@/app/components/InspirationBoard";
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
  const now = new Date();
  const stale = isStale(latestSuccessfulSyncAt, now, config.staleDays);
  const failedRuns = syncRuns.filter((run) => run.status === "failed").length;
  const okRuns = syncRuns.filter(
    (run) => run.status === "ok" || run.status === "partial",
  ).length;
  const boardIdeas = ideas.map((idea) => toBoardIdea(idea));

  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="YouTube Studio"
        title="Inspiration"
        description="Mirror Studio Inspiration, filter ideas, copy titles, then bias Shorts generation and review."
        actions={
          <div className="list-toolbar library-toolbar">
            {stale ? <span className="chip chip-stale">Stale</span> : (
              <span className="chip status-ok">Fresh</span>
            )}
            <InspirationSyncButton />
          </div>
        }
      />

      <section className="pulse-strip inspiration-pulse" aria-label="Inspiration pulse">
        <div className="pulse-card">
          <strong>{ideas.length}</strong>
          <span>Active ideas</span>
        </div>
        <div className="pulse-card">
          <strong>{stale ? "Stale" : "Fresh"}</strong>
          <span>
            {latestSuccessfulSyncAt
              ? `Sync ${formatListDateTime(latestSuccessfulSyncAt)}`
              : "Never synced"}
          </span>
        </div>
        <div className="pulse-card">
          <strong>{okRuns}</strong>
          <span>OK / partial runs</span>
        </div>
        <div className="pulse-card">
          <strong>{failedRuns}</strong>
          <span>Failed runs</span>
        </div>
      </section>

      {ideas.length === 0 ? (
        <section className="empty-panel">
          <span className="stripe-mark" aria-hidden="true" />
          <h2>No active ideas</h2>
          <p>Sync YouTube Studio Inspiration to populate this board.</p>
        </section>
      ) : (
        <InspirationBoard ideas={boardIdeas} />
      )}

      <section className="inspiration-history" aria-label="Sync history">
        <div className="inspiration-history-header">
          <h2 className="inspiration-history-heading">Sync history</h2>
          <p className="muted">
            Last {syncRuns.length} runs · stale after {config.staleDays} days
          </p>
        </div>
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

function toBoardIdea(idea: InspirationIdeaRecord) {
  return {
    id: idea.id,
    title: idea.title,
    summary: idea.summary.trim().replace(/\s+/g, " "),
    audienceInterest: idea.audienceInterest,
    channelAlignment: idea.channelAlignment,
    relatedInterest: formatRelatedInterest(idea.relatedInterest),
    outline: idea.outline,
    suggestedTitles: idea.suggestedTitles,
    thumbnailNotes: idea.thumbnailNotes,
    capturedAt: idea.capturedAt.toISOString(),
  };
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
