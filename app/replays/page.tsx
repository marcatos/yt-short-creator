import Link from "next/link";
import { revalidatePath } from "next/cache";

import { PageHeader } from "@/app/components/PageHeader";
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
    <main className="page-shell">
      <PageHeader
        eyebrow="Race sources"
        title="Replay sessions"
        description="Attach OBS media for AV analysis, or .rpy for Director / Auto capture. Requires iRacing Options → Enable video and screen capture."
        actions={
          <Link className="button button-ghost" href="/candidates">
            Open candidates
          </Link>
        }
      />

      <section className="settings-section">
        <div className="settings-section-header">
          <h2>New session</h2>
          <p>
            Provide a local media path and/or .rpy. IBT is optional enrichment.
          </p>
        </div>
        <form action={createSessionAction} className="replay-create-form">
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
          <button className="button button-primary" type="submit">
            Create session
          </button>
        </form>
      </section>

      {sessions.length === 0 ? (
        <section className="empty-panel">
          <span className="stripe-mark" aria-hidden="true" />
          <h2>No replay sessions yet</h2>
          <p>Create a session from OBS media or an iRacing .rpy path.</p>
        </section>
      ) : (
        <div className="replay-session-list">
          {sessions.map((session) => (
            <article className="settings-section replay-session" key={session.id}>
              <div className="replay-session-header">
                <div>
                  <h2>{session.title}</h2>
                  <p className="muted">
                    {session.trackName ?? "Track unknown"} · {session.status}
                    {session.durationSec
                      ? ` · ${Math.floor(session.durationSec / 60)}:${String(session.durationSec % 60).padStart(2, "0")}`
                      : ""}
                    {session.rpyPath ? "" : " · OBS media-only"}
                  </p>
                  <p className="replay-path mono">
                    {session.rpyPath ?? "(no .rpy)"}
                  </p>
                  <p className="muted">
                    Media: {session.mediaPath ?? "none"} · IBT:{" "}
                    {session.ibtPath ?? "none"} · Events: {session.events.length}
                  </p>
                </div>
                <div className="replay-session-actions">
                  <form action={directorCaptureAction}>
                    <input type="hidden" name="sessionId" value={session.id} />
                    <button className="button button-secondary" type="submit">
                      Director capture
                    </button>
                  </form>
                  <form action={captureReplayAction}>
                    <input type="hidden" name="sessionId" value={session.id} />
                    <button
                      className="button button-secondary"
                      type="submit"
                      disabled={!session.rpyPath}
                    >
                      Auto-record
                    </button>
                  </form>
                  <form action={analyzeReplayAction}>
                    <input type="hidden" name="sessionId" value={session.id} />
                    <button
                      className="button button-secondary"
                      type="submit"
                      disabled={!session.mediaPath}
                    >
                      Analyze AV
                    </button>
                  </form>
                  <form
                    action={publishFullReplayAction}
                    className="replay-publish-form"
                  >
                    <input type="hidden" name="sessionId" value={session.id} />
                    <select
                      name="privacy"
                      defaultValue="unlisted"
                      disabled={!session.racePackage && !session.raceAnalysis}
                      title="YouTube privacy"
                    >
                      <option value="unlisted">unlisted</option>
                      <option value="public">public</option>
                      <option value="private">private</option>
                    </select>
                    <button
                      className="button button-primary"
                      type="submit"
                      disabled={
                        (!session.racePackage && !session.raceAnalysis) ||
                        !session.mediaPath
                      }
                    >
                      Encode + upload
                    </button>
                    <button
                      className="button button-ghost"
                      type="submit"
                      name="voiceOver"
                      value="true"
                      disabled={
                        (!session.racePackage && !session.raceAnalysis) ||
                        !session.mediaPath
                      }
                      title="Single master + IT/EN audio, localizations, captions"
                    >
                      Multi-lang VO
                    </button>
                  </form>
                </div>
              </div>

              {session.fullVideoYoutubeId ? (
                <p>
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
                <p className="muted">
                  Delivery encode ready: {session.fullVideoEncodePath}
                </p>
              ) : null}

              {session.raceAnalysis ? (
                <div className="replay-panel">
                  <h3>Race analysis</h3>
                  <p>
                    <strong>Why watch:</strong> {session.raceAnalysis.whyWatch}
                  </p>
                  <p>
                    <strong>Storyline:</strong>{" "}
                    {session.raceAnalysis.mainStoryline}
                  </p>
                  <p className="muted">
                    {[
                      session.raceAnalysis.context.track,
                      session.raceAnalysis.context.car,
                      session.raceAnalysis.results.startPosition != null &&
                      session.raceAnalysis.results.finishPosition != null
                        ? `P${session.raceAnalysis.results.startPosition} → P${session.raceAnalysis.results.finishPosition}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="muted">
                    Short candidates: {session.raceAnalysis.shortCandidates.length}{" "}
                    (top score{" "}
                    {Math.max(
                      ...session.raceAnalysis.shortCandidates.map(
                        (item) => item.shortScore,
                      ),
                      0,
                    ).toFixed(2)}
                    )
                  </p>
                </div>
              ) : null}

              {session.deliveryAssets ? (
                <div className="replay-panel">
                  <h3>Delivery assets</h3>
                  <ul className="muted">
                    <li>
                      Master:{" "}
                      {session.deliveryAssets.masterVideoPath ?? "(none)"}
                    </li>
                    <li>Audio IT: {session.deliveryAssets.audioItPath ?? "—"}</li>
                    <li>Audio EN: {session.deliveryAssets.audioEnPath ?? "—"}</li>
                    <li>
                      Metadata: {session.deliveryAssets.youtubeMetadataPath}
                    </li>
                  </ul>
                  {(session.publishManualChecklist ??
                    session.deliveryAssets.metadata.manualStudioChecklist)
                    .length > 0 ? (
                    <div>
                      <strong>Studio checklist (manual)</strong>
                      <ol>
                        {(
                          session.publishManualChecklist ??
                          session.deliveryAssets.metadata.manualStudioChecklist
                        ).map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {session.racePackage ? (
                <div className="replay-panel">
                  <h3>Legacy package bridge</h3>
                  <p>
                    <strong>Title:</strong> {session.racePackage.fullVideo.title}
                  </p>
                  <pre className="replay-pre muted">
                    {session.racePackage.fullVideo.description}
                  </pre>
                  <p className="muted">
                    Tags: {session.racePackage.fullVideo.tags.join(", ")}
                  </p>
                  <details>
                    <summary>
                      Race narrative ({session.racePackage.timeline.length}{" "}
                      beats)
                    </summary>
                    <pre className="replay-pre muted">
                      {session.racePackage.transcript}
                    </pre>
                  </details>
                </div>
              ) : null}

              <div className="replay-session-tools">
                <form action={attachMediaAction} className="replay-tool-form">
                  <input type="hidden" name="sessionId" value={session.id} />
                  <label>
                    Attach media
                    <input
                      name="mediaPath"
                      required
                      placeholder="C:\...\file.mkv"
                    />
                  </label>
                  <button className="button button-secondary" type="submit">
                    Attach media
                  </button>
                </form>
                <form action={attachIbtAction} className="replay-tool-form">
                  <input type="hidden" name="sessionId" value={session.id} />
                  <label>
                    Attach IBT
                    <input name="ibtPath" required placeholder="C:\...\file.ibt" />
                  </label>
                  <button className="button button-secondary" type="submit">
                    Attach IBT
                  </button>
                </form>
                <form action={manualMomentAction} className="replay-tool-form">
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
                  <button
                    className="button button-secondary"
                    type="submit"
                    disabled={!session.mediaPath}
                  >
                    Add manual Short
                  </button>
                </form>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
