import Link from "next/link";
import { revalidatePath } from "next/cache";

import { formatCompactCount, formatListDateTime } from "@/app/lib/format";
import { getContainer } from "@/src/lib/container";

import { GenerateIdeasButton } from "./generate-button";

export const dynamic = "force-dynamic";

function youtubeThumbUrl(youtubeVideoId: string): string {
  return `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg`;
}

async function syncChannelAction(formData: FormData): Promise<void> {
  "use server";

  const channelId = formData.get("channelId");
  if (typeof channelId !== "string" || !channelId) {
    throw new Error("A channel ID is required");
  }
  await getContainer().syncChannel(channelId);
  revalidatePath("/library");
}

async function analyzeClipsAction(formData: FormData): Promise<void> {
  "use server";

  const sourceVideoId = formData.get("sourceVideoId");
  if (typeof sourceVideoId !== "string" || !sourceVideoId) {
    throw new Error("A source video ID is required");
  }
  await getContainer().jobQueue.enqueue({
    type: "analyze_clips",
    payload: { sourceVideoId },
  });
  revalidatePath("/library");
}

export default async function LibraryPage() {
  const { repositories } = getContainer();
  const channels = await repositories.channels.list();
  const channel = channels[0] ?? null;
  const [videos, briefs, generatedCandidates] = channel
    ? await Promise.all([
        repositories.sourceVideos.listByChannelId(channel.id),
        repositories.generationBriefs.listByChannelId(channel.id),
        repositories.candidates.list({ origin: "generate" }),
      ])
    : [[], [], []];
  const briefById = new Map(briefs.map((brief) => [brief.id, brief]));
  const channelGeneratedCandidates = generatedCandidates.filter(
    (candidate) =>
      "generationBriefId" in candidate.provenance &&
      briefById.has(candidate.provenance.generationBriefId),
  );

  return (
    <main className="page-shell">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Source catalog</p>
          <h1>{channel?.title ?? "Video library"}</h1>
        </div>
        {channel ? (
          <div className="list-toolbar library-toolbar">
            <GenerateIdeasButton channelId={channel.id} />
            <form action={syncChannelAction}>
              <input type="hidden" name="channelId" value={channel.id} />
              <button className="button button-primary" type="submit">
                Sync now
              </button>
            </form>
          </div>
        ) : null}
      </header>

      {!channel ? (
        <p>
          <Link href="/connect">Connect a YouTube channel</Link> to sync its
          uploads.
        </p>
      ) : videos.length === 0 ? (
        <p className="muted">No uploaded videos were found.</p>
      ) : (
        <div className="library-list">
          {videos.map((video) => {
            const stats = video.analyticsSnapshot;
            return (
              <article className="compact-row library-row" key={video.id}>
                <div className="compact-thumb library-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    loading="lazy"
                    src={youtubeThumbUrl(video.youtubeVideoId)}
                  />
                </div>
                <div className="compact-copy">
                  <h2 className="compact-title">{video.title}</h2>
                  <div className="compact-dates">
                    <span>
                      Caricato{" "}
                      <strong>
                        {video.publishedAt
                          ? formatListDateTime(video.publishedAt)
                          : "—"}
                      </strong>
                    </span>
                    <span>
                      {Math.floor(video.durationSec / 60)}:
                      {String(video.durationSec % 60).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="library-stats">
                    <span>
                      <strong>{formatCompactCount(stats?.viewCount)}</strong>{" "}
                      views
                    </span>
                    <span>
                      <strong>{formatCompactCount(stats?.likeCount)}</strong>{" "}
                      likes
                    </span>
                    <span>
                      <strong>{formatCompactCount(stats?.commentCount)}</strong>{" "}
                      comments
                    </span>
                  </div>
                </div>
                <form action={analyzeClipsAction}>
                  <input
                    type="hidden"
                    name="sourceVideoId"
                    value={video.id}
                  />
                  <button className="button button-secondary" type="submit">
                    Analyze clips
                  </button>
                </form>
              </article>
            );
          })}
        </div>
      )}
      {channelGeneratedCandidates.length > 0 ? (
        <section className="library-ideas">
          <h2>Generated Shorts ideas</h2>
          <div className="queue-list">
            {channelGeneratedCandidates.map((candidate) => {
              if (!("generationBriefId" in candidate.provenance)) return null;
              const brief = briefById.get(candidate.provenance.generationBriefId);
              if (!brief) return null;
              return (
                <article className="settings-card" key={candidate.id}>
                  <h3>{candidate.title}</h3>
                  <p>
                    <strong>Hook:</strong> {brief.hook}
                  </p>
                  <p>{brief.script}</p>
                  {candidate.provenance.timeline.length === 0 ? (
                    <p className="muted">
                      Script-only preview — add footage to media/broll to
                      assemble visuals.
                    </p>
                  ) : (
                    <p className="muted">
                      Preview uses {candidate.provenance.timeline.length} B-roll
                      assets.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
      <p className="library-footer">
        <Link href="/">Back home</Link>
      </p>
    </main>
  );
}
