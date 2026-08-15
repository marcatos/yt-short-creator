import Link from "next/link";

import { PageHeader } from "@/app/components/PageHeader";
import { formatListDateTime } from "@/app/lib/format";
import { parseInspirationConfig } from "@/src/domain/inspiration-config";
import { getContainer } from "@/src/lib/container";

export const dynamic = "force-dynamic";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "paused"]);

function isInspirationStale(
  latestSuccessfulSyncAt: Date | null,
  now: Date,
  staleDays: number,
): boolean {
  if (!latestSuccessfulSyncAt) return true;
  return now.getTime() - latestSuccessfulSyncAt.getTime() > staleDays * MS_PER_DAY;
}

export default async function HomePage() {
  const container = getContainer();
  const channels = await container.repositories.channels.list();
  const connectedChannel = channels[0] ?? null;

  const [reviewCandidates, sourceVideos, latestInspirationSync] =
    await Promise.all([
      container.listCandidates({ status: "proposed" }),
      connectedChannel
        ? container.repositories.sourceVideos.listByChannelId(
            connectedChannel.id,
          )
        : Promise.resolve([]),
      container.repositories.inspiration.getLatestSuccessfulSyncAt(),
    ]);

  const activeJobs = container.jobQueue
    .listJobs()
    .filter((job) => ACTIVE_JOB_STATUSES.has(job.status)).length;

  const inspirationConfig = parseInspirationConfig(process.env);
  const inspirationStale = isInspirationStale(
    latestInspirationSync,
    new Date(),
    inspirationConfig.staleDays,
  );

  const primaryHref = !connectedChannel
    ? "/connect"
    : reviewCandidates.length > 0
      ? "/candidates?status=proposed"
      : "/library";
  const primaryLabel = !connectedChannel
    ? "Connect YouTube"
    : reviewCandidates.length > 0
      ? "Review queue"
      : "View library";

  return (
    <main className="page-shell">
      <section className="home-hero" aria-label="Short Control desk">
        <span className="home-hero-stripe" aria-hidden="true" />
        <PageHeader
          eyebrow="S.Marcato 42 Racing"
          title="Short Control"
          description={
            connectedChannel
              ? `${connectedChannel.title} is connected and ready to sync.`
              : "Analyze your channel, propose branded Shorts from clips and generation, approve locally, and upload to YouTube."
          }
          actions={
            <div className="home-cta-row">
              <Link className="button button-primary" href={primaryHref}>
                {primaryLabel}
              </Link>
              {connectedChannel ? (
                <Link className="button button-ghost" href="/connect">
                  Connection
                </Link>
              ) : null}
            </div>
          }
        />
      </section>

      <section className="pulse-strip" aria-label="Pipeline pulse">
        <Link className="pulse-card" href="/candidates?status=proposed">
          <strong>{reviewCandidates.length}</strong>
          <span>To review</span>
        </Link>
        <Link className="pulse-card" href="/jobs">
          <strong>{activeJobs}</strong>
          <span>Active jobs</span>
        </Link>
        <Link className="pulse-card" href="/library">
          <strong>{sourceVideos.length}</strong>
          <span>Library videos</span>
        </Link>
        <Link className="pulse-card" href="/inspiration">
          <strong>{inspirationStale ? "Stale" : "Fresh"}</strong>
          <span>
            {latestInspirationSync
              ? `Sync ${formatListDateTime(latestInspirationSync)}`
              : "Never synced"}
          </span>
        </Link>
      </section>
    </main>
  );
}
