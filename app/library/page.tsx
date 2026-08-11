import Link from "next/link";
import { revalidatePath } from "next/cache";

import { getContainer } from "@/src/lib/container";

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

export default async function LibraryPage() {
  const { repositories } = getContainer();
  const channels = await repositories.channels.list();
  const channel = channels[0] ?? null;
  const videos = channel
    ? await repositories.sourceVideos.listByChannelId(channel.id)
    : [];

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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ marginTop: "2rem" }}>
        <Link href="/">Back home</Link>
      </p>
    </main>
  );
}
