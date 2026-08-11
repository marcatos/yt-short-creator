import Link from "next/link";
import { revalidatePath } from "next/cache";

import { getContainer } from "@/src/lib/container";

import { GenerateIdeasButton } from "./generate-button";

export const dynamic = "force-dynamic";

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
    <main style={{ maxWidth: "72rem", margin: "0 auto", padding: "3rem 2rem" }}>
      <header
        style={{
          display: "flex",
          alignItems: "end",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <p
            style={{
              color: "var(--ice-dim)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Source catalog
          </p>
          <h1 style={{ marginBottom: 0 }}>
            {channel?.title ?? "Video library"}
          </h1>
        </div>
        {channel ? (
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "start" }}>
            <GenerateIdeasButton channelId={channel.id} />
            <form action={syncChannelAction}>
              <input type="hidden" name="channelId" value={channel.id} />
              <button
                type="submit"
                style={{
                  border: 0,
                  borderRadius: "4px",
                  padding: "0.7rem 1rem",
                  background: "var(--rosso)",
                  color: "var(--ice)",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                Sync now
              </button>
            </form>
          </div>
        ) : null}
      </header>

      {!channel ? (
        <p style={{ marginTop: "2rem" }}>
          <Link href="/connect">Connect a YouTube channel</Link> to sync its
          uploads.
        </p>
      ) : videos.length === 0 ? (
        <p style={{ marginTop: "2rem", color: "var(--ice-dim)" }}>
          No uploaded videos were found.
        </p>
      ) : (
        <div style={{ overflowX: "auto", marginTop: "2rem" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ice-dim)" }}>
                <th style={{ padding: "0.75rem", borderBottom: "1px solid #333" }}>
                  Title
                </th>
                <th style={{ padding: "0.75rem", borderBottom: "1px solid #333" }}>
                  Duration
                </th>
                <th style={{ padding: "0.75rem", borderBottom: "1px solid #333" }}>
                  Published
                </th>
                <th style={{ padding: "0.75rem", borderBottom: "1px solid #333" }}>
                  YouTube ID
                </th>
                <th style={{ padding: "0.75rem", borderBottom: "1px solid #333" }}>
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {videos.map((video) => (
                <tr key={video.id}>
                  <td
                    style={{ padding: "0.75rem", borderBottom: "1px solid #222" }}
                  >
                    {video.title}
                  </td>
                  <td
                    style={{ padding: "0.75rem", borderBottom: "1px solid #222" }}
                  >
                    {Math.floor(video.durationSec / 60)}:
                    {String(video.durationSec % 60).padStart(2, "0")}
                  </td>
                  <td
                    style={{ padding: "0.75rem", borderBottom: "1px solid #222" }}
                  >
                    {video.publishedAt?.toISOString().slice(0, 10) ?? "—"}
                  </td>
                  <td
                    style={{
                      padding: "0.75rem",
                      borderBottom: "1px solid #222",
                      fontFamily: "monospace",
                    }}
                  >
                    {video.youtubeVideoId}
                  </td>
                  <td
                    style={{ padding: "0.75rem", borderBottom: "1px solid #222" }}
                  >
                    <form action={analyzeClipsAction}>
                      <input
                        type="hidden"
                        name="sourceVideoId"
                        value={video.id}
                      />
                      <button type="submit">Analyze clips</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {channelGeneratedCandidates.length > 0 ? (
        <section style={{ marginTop: "3rem" }}>
          <h2>Generated Shorts ideas</h2>
          <div style={{ display: "grid", gap: "1rem" }}>
            {channelGeneratedCandidates.map((candidate) => {
              if (!("generationBriefId" in candidate.provenance)) return null;
              const brief = briefById.get(candidate.provenance.generationBriefId);
              if (!brief) return null;
              return (
                <article
                  key={candidate.id}
                  style={{ border: "1px solid #333", padding: "1rem" }}
                >
                  <h3>{candidate.title}</h3>
                  <p><strong>Hook:</strong> {brief.hook}</p>
                  <p>{brief.script}</p>
                  {candidate.provenance.timeline.length === 0 ? (
                    <p style={{ color: "var(--ice-dim)" }}>
                      Script-only preview — add footage to media/broll to assemble visuals.
                    </p>
                  ) : (
                    <p style={{ color: "var(--ice-dim)" }}>
                      Preview uses {candidate.provenance.timeline.length} B-roll assets.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
      <p style={{ marginTop: "2rem" }}>
        <Link href="/">Back home</Link>
      </p>
    </main>
  );
}
