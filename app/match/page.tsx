import Link from "next/link";

import { MatchBoard } from "@/app/components/MatchBoard";
import { PageHeader } from "@/app/components/PageHeader";
import { formatListDateTime } from "@/app/lib/format";
import { parseInspirationConfig } from "@/src/domain/inspiration-config";
import { getContainer } from "@/src/lib/container";

export const dynamic = "force-dynamic";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isStale(
  latestSuccessfulSyncAt: Date | null,
  now: Date,
  staleDays: number,
): boolean {
  if (!latestSuccessfulSyncAt) return true;
  return (
    now.getTime() - latestSuccessfulSyncAt.getTime() > staleDays * MS_PER_DAY
  );
}

export default async function MatchPage() {
  const container = getContainer();
  const config = parseInspirationConfig(process.env);
  const channels = await container.repositories.channels.list();
  const channel = channels[0] ?? null;

  const [videos, ideas, latestSuccessfulSyncAt] = channel
    ? await Promise.all([
        container.repositories.sourceVideos.listByChannelId(channel.id),
        container.repositories.inspiration.listActiveIdeas(),
        container.repositories.inspiration.getLatestSuccessfulSyncAt(),
      ])
    : [[], [], null];

  const now = container.clock.now();
  const stale = isStale(latestSuccessfulSyncAt, now, config.staleDays);

  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="Pipeline"
        title="Match"
        description="Pair library videos with Inspiration ideas, rank the best fits, then analyze and fill Shorts into review."
        actions={
          <div className="list-toolbar library-toolbar">
            {stale ? (
              <span className="chip chip-stale">Stale</span>
            ) : (
              <span className="chip status-ok">Fresh</span>
            )}
            <Link className="button button-ghost" href="/inspiration">
              Inspiration
            </Link>
            <Link className="button button-ghost" href="/library">
              Library
            </Link>
          </div>
        }
      />

      <section className="pulse-strip" aria-label="Match pulse">
        <div className="pulse-card">
          <strong>{videos.length}</strong>
          <span>Library videos</span>
        </div>
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
      </section>

      {!channel ? (
        <section className="empty-panel">
          <span className="stripe-mark" aria-hidden="true" />
          <h2>Connect a channel</h2>
          <p>
            <Link href="/connect">Connect YouTube</Link> before matching videos
            to Inspiration.
          </p>
        </section>
      ) : videos.length === 0 || ideas.length === 0 ? (
        <section className="empty-panel">
          <span className="stripe-mark" aria-hidden="true" />
          <h2>Need videos and ideas</h2>
          <p>
            Sync the{" "}
            <Link href="/library">library</Link> and{" "}
            <Link href="/inspiration">Inspiration</Link> first.
          </p>
        </section>
      ) : (
        <MatchBoard
          channelId={channel.id}
          inspirationStale={stale}
          videos={videos.map((video) => ({
            id: video.id,
            title: video.title,
            durationSec: video.durationSec,
            viewCount: video.analyticsSnapshot?.viewCount ?? null,
            likeCount: video.analyticsSnapshot?.likeCount ?? null,
            commentCount: video.analyticsSnapshot?.commentCount ?? null,
          }))}
          ideas={ideas.map((idea) => ({
            id: idea.id,
            title: idea.title,
            summary: idea.summary,
            audienceInterest: idea.audienceInterest,
            channelAlignment: idea.channelAlignment,
          }))}
        />
      )}
    </main>
  );
}
