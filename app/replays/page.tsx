import Link from "next/link";
import { revalidatePath } from "next/cache";

import { getContainer } from "@/src/lib/container";

export const dynamic = "force-dynamic";

async function createSessionAction(formData: FormData): Promise<void> {
  "use server";

  const rpyPath = String(formData.get("rpyPath") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const trackName = String(formData.get("trackName") ?? "").trim();
  const mediaPath = String(formData.get("mediaPath") ?? "").trim();
  const ibtPath = String(formData.get("ibtPath") ?? "").trim();
  if (!rpyPath && !mediaPath) {
    throw new Error("Provide a .rpy path and/or a local media path (OBS MKV/MP4)");
  }

  const container = getContainer();
  const session = await container.createReplaySession({
    rpyPath: rpyPath || null,
    title: title || undefined,
    trackName: trackName || null,
    mediaPath: mediaPath || null,
    ibtPath: ibtPath || null,
  });

  if (mediaPath) {
    await container.attachReplayMedia({
      sessionId: session.id,
      mediaPath,
    });
  }
  if (ibtPath) {
    await container.attachReplayIbt({ sessionId: session.id, ibtPath });
  }

  revalidatePath("/replays");
}

async function attachMediaAction(formData: FormData): Promise<void> {
  "use server";
  const sessionId = String(formData.get("sessionId") ?? "");
  const mediaPath = String(formData.get("mediaPath") ?? "").trim();
  await getContainer().attachReplayMedia({ sessionId, mediaPath });
  revalidatePath("/replays");
}

async function attachIbtAction(formData: FormData): Promise<void> {
  "use server";
  const sessionId = String(formData.get("sessionId") ?? "");
  const ibtPath = String(formData.get("ibtPath") ?? "").trim();
  await getContainer().attachReplayIbt({ sessionId, ibtPath });
  revalidatePath("/replays");
}

async function analyzeReplayAction(formData: FormData): Promise<void> {
  "use server";
  const sessionId = String(formData.get("sessionId") ?? "");
  await getContainer().jobQueue.enqueue({
    type: "analyze_replay",
    payload: { sessionId },
  });
  revalidatePath("/replays");
  revalidatePath("/candidates");
  revalidatePath("/jobs");
}

async function captureReplayAction(formData: FormData): Promise<void> {
  "use server";
  const sessionId = String(formData.get("sessionId") ?? "");
  await getContainer().jobQueue.enqueue({
    type: "capture_replay",
    payload: { sessionId },
  });
  revalidatePath("/replays");
  revalidatePath("/jobs");
}

async function publishFullReplayAction(formData: FormData): Promise<void> {
  "use server";
  const sessionId = String(formData.get("sessionId") ?? "");
  const privacyRaw = String(formData.get("privacy") ?? "unlisted");
  const privacy =
    privacyRaw === "public" || privacyRaw === "private" || privacyRaw === "unlisted"
      ? privacyRaw
      : "unlisted";
  const voiceOver = formData.get("voiceOver") === "true";
  await getContainer().requestFullReplayPublish({
    sessionId,
    privacy,
    voiceOver,
  });
  revalidatePath("/replays");
  revalidatePath("/jobs");
}

async function directorCaptureAction(formData: FormData): Promise<void> {
  "use server";
  const sessionId = String(formData.get("sessionId") ?? "");
  await getContainer().jobQueue.enqueue({
    type: "director_capture_replay",
    payload: { sessionId },
  });
  revalidatePath("/replays");
  revalidatePath("/candidates");
  revalidatePath("/jobs");
}

async function manualMomentAction(formData: FormData): Promise<void> {
  "use server";
  const sessionId = String(formData.get("sessionId") ?? "");
  const startSec = Number(formData.get("startSec"));
  const endSec = Number(formData.get("endSec"));
  const title = String(formData.get("title") ?? "").trim();
  await getContainer().addManualReplayMoment({
    sessionId,
    startMs: Math.round(startSec * 1000),
    endMs: Math.round(endSec * 1000),
    title: title || undefined,
  });
  revalidatePath("/replays");
  revalidatePath("/candidates");
}

export default async function ReplaysPage() {
  const sessions = await getContainer().repositories.replaySessions.list();
  sessions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <main style={{ maxWidth: "72rem", margin: "0 auto", padding: "3rem 2rem" }}>
      <header style={{ marginBottom: "2rem" }}>
        <p
          style={{
            color: "var(--ice-dim)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Race sources
        </p>
        <h1 style={{ marginBottom: "0.5rem" }}>Replay sessions</h1>
        <p style={{ color: "var(--ice-dim)", maxWidth: "46rem" }}>
          Attach an OBS <code>.mkv</code>/<code>.mp4</code> for AV analysis
          (transcript + YouTube title/description + Shorts). For a{" "}
          <code>.rpy</code>, use{" "}
          <strong>Director capture</strong> for ReplayDirector-style highlight
          shots (seek events, switch cameras, stitch a reel), or{" "}
          <strong>Auto-record</strong> for a continuous take. Requires{" "}
          <em>Options → Enable video and screen capture</em> in iRacing. AV
          analysis builds a lightweight proxy and never re-reads the full 2K
          file once cached.
        </p>
      </header>

      <section
        style={{
          border: "1px solid #333",
          padding: "1.25rem",
          marginBottom: "2.5rem",
        }}
      >
        <h2 style={{ marginTop: 0 }}>New session</h2>
        <form
          action={createSessionAction}
          style={{ display: "grid", gap: "0.75rem", maxWidth: "40rem" }}
        >
          <label>
            OBS / local media path (MKV/MP4)
            <input
              name="mediaPath"
              placeholder="C:\Users\...\race-rec2k.mkv"
            />
          </label>
          <label>
            Path to .rpy (optional if media is set)
            <input name="rpyPath" placeholder="C:\...\race.rpy" />
          </label>
          <label>
            Title (optional)
            <input name="title" placeholder="Oschersleben race 12 Aug" />
          </label>
          <label>
            Track (optional)
            <input name="trackName" placeholder="Oschersleben" />
          </label>
          <label>
            IBT path (optional enrichment)
            <input name="ibtPath" placeholder="C:\...\telemetry.ibt" />
          </label>
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
              width: "fit-content",
            }}
          >
            Create session
          </button>
        </form>
      </section>

      {sessions.length === 0 ? (
        <p style={{ color: "var(--ice-dim)" }}>No replay sessions yet.</p>
      ) : (
        <div style={{ display: "grid", gap: "1.5rem" }}>
          {sessions.map((session) => (
            <article
              key={session.id}
              style={{ border: "1px solid #333", padding: "1.25rem" }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <h2 style={{ margin: "0 0 0.35rem" }}>{session.title}</h2>
                  <p style={{ margin: 0, color: "var(--ice-dim)" }}>
                    {session.trackName ?? "Track unknown"} · {session.status}
                    {session.durationSec
                      ? ` · ${Math.floor(session.durationSec / 60)}:${String(session.durationSec % 60).padStart(2, "0")}`
                      : ""}
                    {session.rpyPath ? "" : " · OBS media-only"}
                  </p>
                  <p
                    style={{
                      margin: "0.5rem 0 0",
                      fontFamily: "monospace",
                      fontSize: "0.85rem",
                      color: "var(--ice-dim)",
                    }}
                  >
                    {session.rpyPath ?? "(no .rpy)"}
                  </p>
                  <p style={{ margin: "0.25rem 0 0", color: "var(--ice-dim)" }}>
                    Media: {session.mediaPath ?? "none"} · IBT:{" "}
                    {session.ibtPath ?? "none"} · Events: {session.events.length}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <form action={directorCaptureAction}>
                    <input type="hidden" name="sessionId" value={session.id} />
                    <button type="submit">Director capture</button>
                  </form>
                  <form action={captureReplayAction}>
                    <input type="hidden" name="sessionId" value={session.id} />
                    <button type="submit" disabled={!session.rpyPath}>
                      Auto-record replay
                    </button>
                  </form>
                  <form action={analyzeReplayAction}>
                    <input type="hidden" name="sessionId" value={session.id} />
                    <button type="submit" disabled={!session.mediaPath}>
                      Analyze AV
                    </button>
                  </form>
                  <form
                    action={publishFullReplayAction}
                    style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}
                  >
                    <input type="hidden" name="sessionId" value={session.id} />
                    <select
                      name="privacy"
                      defaultValue="unlisted"
                      disabled={!session.racePackage}
                      title="YouTube privacy"
                    >
                      <option value="unlisted">unlisted</option>
                      <option value="public">public</option>
                      <option value="private">private</option>
                    </select>
                    <button
                      type="submit"
                      disabled={!session.racePackage || !session.mediaPath}
                    >
                      Encode + upload full
                    </button>
                    <button
                      type="submit"
                      name="voiceOver"
                      value="true"
                      disabled={!session.racePackage || !session.mediaPath}
                    >
                      Encode + upload full IT+EN VO
                    </button>
                  </form>
                </div>
              </div>

              {session.fullVideoYoutubeId ? (
                <p style={{ marginTop: "0.75rem" }}>
                  Full video on YouTube:{" "}
                  <a
                    href={`https://youtu.be/${session.fullVideoYoutubeId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    youtu.be/{session.fullVideoYoutubeId}
                  </a>
                  {session.fullVideoPrivacy
                    ? ` (${session.fullVideoPrivacy})`
                    : ""}
                </p>
              ) : session.fullVideoEncodePath ? (
                <p style={{ marginTop: "0.75rem", color: "var(--ice-dim)" }}>
                  Delivery encode ready: {session.fullVideoEncodePath}
                </p>
              ) : null}

              {session.racePackage ? (
                <div
                  style={{
                    marginTop: "1rem",
                    padding: "1rem",
                    background: "#141414",
                    border: "1px solid #2a2a2a",
                    display: "grid",
                    gap: "0.75rem",
                  }}
                >
                  <h3 style={{ margin: 0 }}>YouTube long-form package</h3>
                  <p style={{ margin: 0 }}>
                    <strong>Title:</strong> {session.racePackage.fullVideo.title}
                  </p>
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      fontFamily: "inherit",
                      color: "var(--ice-dim)",
                    }}
                  >
                    {session.racePackage.fullVideo.description}
                  </pre>
                  <p style={{ margin: 0, color: "var(--ice-dim)" }}>
                    Tags: {session.racePackage.fullVideo.tags.join(", ")}
                  </p>
                  <details>
                    <summary style={{ cursor: "pointer" }}>
                      Race transcript ({session.racePackage.timeline.length}{" "}
                      beats)
                    </summary>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        fontFamily: "inherit",
                        color: "var(--ice-dim)",
                      }}
                    >
                      {session.racePackage.transcript}
                    </pre>
                  </details>
                </div>
              ) : null}

              <div
                style={{
                  display: "grid",
                  gap: "0.75rem",
                  marginTop: "1rem",
                  gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))",
                }}
              >
                <form
                  action={attachMediaAction}
                  style={{ display: "grid", gap: "0.4rem" }}
                >
                  <input type="hidden" name="sessionId" value={session.id} />
                  <label>
                    Attach media
                    <input
                      name="mediaPath"
                      required
                      placeholder="C:\...\file.mkv"
                    />
                  </label>
                  <button type="submit">Attach media</button>
                </form>
                <form
                  action={attachIbtAction}
                  style={{ display: "grid", gap: "0.4rem" }}
                >
                  <input type="hidden" name="sessionId" value={session.id} />
                  <label>
                    Attach IBT
                    <input name="ibtPath" required placeholder="C:\...\file.ibt" />
                  </label>
                  <button type="submit">Attach IBT</button>
                </form>
                <form
                  action={manualMomentAction}
                  style={{ display: "grid", gap: "0.4rem" }}
                >
                  <input type="hidden" name="sessionId" value={session.id} />
                  <label>
                    Manual start (sec)
                    <input name="startSec" type="number" min={0} step={0.1} required />
                  </label>
                  <label>
                    Manual end (sec)
                    <input name="endSec" type="number" min={0} step={0.1} required />
                  </label>
                  <label>
                    Title (optional)
                    <input name="title" />
                  </label>
                  <button type="submit" disabled={!session.mediaPath}>
                    Add manual Short
                  </button>
                </form>
              </div>
            </article>
          ))}
        </div>
      )}

      <p style={{ marginTop: "2rem" }}>
        <Link href="/candidates">Open candidates</Link>
        {" · "}
        <Link href="/">Home</Link>
      </p>
    </main>
  );
}
