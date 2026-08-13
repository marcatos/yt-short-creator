/**
 * Resume final VO publish after an interrupted regen (renders already ready).
 * Usage: npx tsx scripts/resume-vo-final-publish.ts --session-id <uuid> --candidate-id <uuid>
 */
import fs from "node:fs";
import path from "node:path";

import { loadEnv } from "../src/lib/env";
import { getContainer, startWorkers } from "../src/lib/container";
import { createPublishVoShortPair } from "../src/application/publish-vo-short-pair";

function loadEnvLocal(): void {
  const envPath = path.resolve(".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env) || !process.env[key]) process.env[key] = value;
  }
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i < 0 ? undefined : process.argv[i + 1];
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  loadEnvLocal();
  loadEnv();
  const sessionId = argValue("--session-id");
  const candidateId = argValue("--candidate-id");
  if (!sessionId || !candidateId) {
    throw new Error("Need --session-id and --candidate-id");
  }

  const container = getContainer();
  startWorkers();

  for (const job of container.jobQueue.listJobs()) {
    if (!["queued", "running", "paused"].includes(job.status)) continue;
    const touches =
      (job.type === "publish_full_replay" &&
        job.payload.sessionId === sessionId) ||
      ((job.type === "publish_short" || job.type === "render_short") &&
        job.payload.candidateId === candidateId);
    if (touches) {
      await container.jobQueue.cancel(job.id);
      container.logger.info("Cancelled stale job before resume", {
        jobId: job.id,
        type: job.type,
      });
    }
  }

  // Clear full VO youtube ids / sidecars so upload is not skipped.
  const session = await container.repositories.replaySessions.getById(sessionId);
  if (!session) throw new Error("session missing");
  await container.repositories.replaySessions.save({
    ...session,
    fullVoiceOvers: (session.fullVoiceOvers ?? []).map((pkg) => ({
      ...pkg,
      youtubeVideoId: null,
      youtubeCaptionId: null,
    })),
    updatedAt: container.clock.now(),
  });
  for (const language of ["it", "en"] as const) {
    const sidecar = container.mediaStore.fullVoPublishCheckpointPath?.(
      sessionId,
      language,
    );
    if (sidecar && fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }

  const publishPair = createPublishVoShortPair({
    candidates: container.repositories.candidates,
    queue: container.jobQueue,
    logger: container.logger,
  });
  const shortJobIds = await publishPair({ candidateId });
  const { jobId: fullJobId } = await container.requestFullReplayPublish({
    sessionId,
    privacy: "unlisted",
    voiceOver: true,
  });

  container.logger.info("Resume publish enqueued", {
    shortJobIds,
    fullJobId,
  });

  const started = Date.now();
  const waitMs = 6 * 60 * 60 * 1000;
  while (Date.now() - started < waitMs) {
    const pending = container.jobQueue.listJobs().filter((job) => {
      if (!["queued", "running", "paused"].includes(job.status)) return false;
      if (
        job.type === "publish_full_replay" &&
        job.payload.sessionId === sessionId
      ) {
        return true;
      }
      return (
        job.type === "publish_short" &&
        job.payload.candidateId === candidateId
      );
    });
    if (pending.length === 0) break;
    container.logger.info("Resume waiting", {
      pending: pending.map((j) => ({
        id: j.id,
        type: j.type,
        status: j.status,
        progress: j.progressPct,
        message: j.progressMessage,
      })),
    });
    await sleep(15_000);
  }

  const cand = await container.repositories.candidates.getById(candidateId);
  const finalSession =
    await container.repositories.replaySessions.getById(sessionId);
  const report = {
    shorts: (cand?.voiceOvers ?? []).map((v) => ({
      language: v.language,
      youtubeVideoId: v.youtubeVideoId,
      url: v.youtubeVideoId ? `https://youtu.be/${v.youtubeVideoId}` : null,
    })),
    full: (finalSession?.fullVoiceOvers ?? []).map((v) => ({
      language: v.language,
      youtubeVideoId: v.youtubeVideoId,
      url: v.youtubeVideoId ? `https://youtu.be/${v.youtubeVideoId}` : null,
    })),
  };
  const outPath = path.join("media", "vo-final-resume-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, outPath, report }, null, 2));
  container.connection.close();
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
