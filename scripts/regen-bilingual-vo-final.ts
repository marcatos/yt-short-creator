/**
 * Force-regenerate bilingual VO (Shorts + full) with current copy/TTS/captions/quality
 * and upload new unlisted IT+EN YouTube videos for final comparison.
 *
 * Usage:
 *   npx tsx scripts/regen-bilingual-vo-final.ts --session-id <uuid>
 *     [--shorts-only | --full-only]
 *     [--limit N]
 *     [--candidate-id <uuid>]   # only this short
 *     [--wait-ms <ms>]         # max wait for queue drain (default 6h)
 */
import fs from "node:fs";
import path from "node:path";

import { loadEnv } from "../src/lib/env";
import { getContainer, startWorkers } from "../src/lib/container";
import { isReplayProvenance } from "../src/domain/replay";
import type { ShortCandidate } from "../src/domain/entities";
import type {
  VoiceOverLanguage,
  VoiceOverPackage,
} from "../src/domain/voice-over";

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
    if (!(key in process.env) || !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function stripPublishIds(pkg: VoiceOverPackage): VoiceOverPackage {
  return {
    ...pkg,
    youtubeVideoId: null,
    youtubeCaptionId: null,
    renderOutputPath: null,
  };
}

function unlinkIfExists(filePath: string | undefined): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // best-effort
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function relevantJobs(
  container: ReturnType<typeof getContainer>,
  sessionId: string,
  candidateIds: Set<string>,
) {
  return container.jobQueue.listJobs().filter((job) => {
    if (!["queued", "running", "paused"].includes(job.status)) return false;
    if (job.type === "publish_full_replay") {
      return (
        job.payload.sessionId === sessionId &&
        Boolean(job.payload.voiceOver) === true
      );
    }
    if (job.type === "render_short" || job.type === "publish_short") {
      const id = String(job.payload.candidateId ?? "");
      return candidateIds.has(id);
    }
    return false;
  });
}

async function waitForDrain(input: {
  container: ReturnType<typeof getContainer>;
  sessionId: string;
  candidateIds: Set<string>;
  waitMs: number;
}): Promise<void> {
  const started = Date.now();
  let lastLog = 0;
  while (Date.now() - started < input.waitMs) {
    const pending = relevantJobs(
      input.container,
      input.sessionId,
      input.candidateIds,
    );
    if (pending.length === 0) return;
    if (Date.now() - lastLog > 15_000) {
      lastLog = Date.now();
      input.container.logger.info("Waiting for VO jobs to finish", {
        pending: pending.map((j) => ({
          id: j.id,
          type: j.type,
          status: j.status,
          progress: j.progressPct,
          message: j.progressMessage,
        })),
        elapsedMs: Date.now() - started,
      });
    }
    await sleep(3000);
  }
  throw new Error(
    `Timed out waiting for VO jobs after ${input.waitMs}ms; still pending: ${
      relevantJobs(input.container, input.sessionId, input.candidateIds)
        .map((j) => `${j.type}:${j.id}:${j.status}`)
        .join(", ")
    }`,
  );
}

async function main(): Promise<void> {
  loadEnvLocal();
  const sessionId = argValue("--session-id");
  if (!sessionId) throw new Error("Missing --session-id");
  const shortsOnly = hasFlag("--shorts-only");
  const fullOnly = hasFlag("--full-only");
  const onlyCandidateId = argValue("--candidate-id");
  const limitRaw = argValue("--limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const waitMs = Number(argValue("--wait-ms") ?? String(6 * 60 * 60 * 1000));

  loadEnv(); // validate env; getContainer() loads it again for the singleton
  const container = getContainer();
  await container.mediaStore.ensureDirs();
  // Must share this singleton queue so enqueue() wakes claimNext().
  startWorkers();

  // Drop stale queued jobs from a prior interrupted regen for this session/candidate.
  for (const job of container.jobQueue.listJobs()) {
    if (!["queued", "paused", "running"].includes(job.status)) continue;
    const isFullVo =
      job.type === "publish_full_replay" &&
      job.payload.sessionId === sessionId &&
      Boolean(job.payload.voiceOver);
    const isShort =
      (job.type === "render_short" || job.type === "publish_short") &&
      (!onlyCandidateId ||
        String(job.payload.candidateId ?? "") === onlyCandidateId);
    if (isFullVo || (onlyCandidateId && isShort) || (!onlyCandidateId && !fullOnly && isShort)) {
      await container.jobQueue.cancel(job.id);
      container.logger.info("Cancelled stale VO job before regen", {
        jobId: job.id,
        type: job.type,
        status: job.status,
      });
    }
  }

  const session = await container.repositories.replaySessions.getById(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  const settings = await container.settings.get();
  if (!settings.enableVoiceOverPipeline) {
    throw new Error("enableVoiceOverPipeline is false in settings");
  }

  const report: Record<string, unknown> = {
    sessionId,
    startedAt: new Date().toISOString(),
    settings: {
      italianVoiceProfile: settings.italianVoiceProfile,
      brandVoiceProfile: settings.brandVoiceProfile,
      shortsBurnInCaptions: settings.shortsBurnInCaptions,
      voiceDuckDb: settings.voiceDuckDb,
    },
    previous: {
      fullCanonical: session.fullVideoYoutubeId,
      fullVo: (session.fullVoiceOvers ?? []).map((v) => ({
        language: v.language,
        youtubeVideoId: v.youtubeVideoId,
        scriptHash: v.scriptHash,
      })),
    },
    shorts: [] as unknown[],
    full: null as unknown,
  };

  const touchedCandidateIds = new Set<string>();

  if (!fullOnly) {
    const all = await container.repositories.candidates.list({});
    let candidates = all.filter(
      (c) =>
        isReplayProvenance(c.provenance) &&
        c.provenance.replaySessionId === sessionId,
    );
    candidates.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (onlyCandidateId) {
      candidates = candidates.filter((c) => c.id === onlyCandidateId);
    }
    if (limit && Number.isFinite(limit)) {
      candidates = candidates.slice(0, limit);
    }

    container.logger.info("Force-regenerating Short VO set", {
      sessionId,
      candidateCount: candidates.length,
      voices: {
        it: settings.italianVoiceProfile,
        en: settings.brandVoiceProfile,
      },
    });

    for (const candidate of candidates) {
      const shortStarted = performance.now();
      touchedCandidateIds.add(candidate.id);

      for (const language of ["it", "en"] as const) {
        unlinkIfExists(
          container.mediaStore.voPublishCheckpointPath?.(
            candidate.id,
            language,
          ),
        );
      }

      // Reset to proposed so approve can re-enqueue bilingual renders.
      const reset: ShortCandidate = {
        ...candidate,
        status: "proposed",
        voiceOvers: [],
        renderOutputPath: null,
        updatedAt: container.clock.now(),
      };
      await container.repositories.candidates.save(reset);

      const packages = await container.generateShortVoiceOvers({
        candidateId: candidate.id,
      });
      await container.approveCandidate({ candidateId: candidate.id });

      (report.shorts as unknown[]).push({
        candidateId: candidate.id,
        title: candidate.title,
        packages: packages.map((p) => ({
          language: p.language,
          voiceProfile: p.voiceProfile,
          scriptHash: p.scriptHash,
          wordCount: p.words.length,
          audioPath: p.audioPath,
        })),
        durationMs: Math.round(performance.now() - shortStarted),
      });

      container.logger.info("Short VO generated and approved", {
        candidateId: candidate.id,
        durationMs: Math.round(performance.now() - shortStarted),
      });
    }
  }

  if (!shortsOnly) {
    const fresh = await container.repositories.replaySessions.getById(sessionId);
    if (!fresh) throw new Error("session vanished");
    await container.repositories.replaySessions.save({
      ...fresh,
      fullVoiceOvers: (fresh.fullVoiceOvers ?? []).map(stripPublishIds),
      updatedAt: container.clock.now(),
    });

    for (const language of ["it", "en"] as VoiceOverLanguage[]) {
      unlinkIfExists(
        container.mediaStore.fullVoPublishCheckpointPath?.(
          sessionId,
          language,
        ),
      );
    }

    const packages = await container.generateFullVoiceOvers({
      sessionId,
      regenerate: true,
    });
    const { jobId } = await container.requestFullReplayPublish({
      sessionId,
      privacy: "unlisted",
      voiceOver: true,
    });
    report.full = {
      jobId,
      packages: packages.map((p) => ({
        language: p.language,
        voiceProfile: p.voiceProfile,
        scriptHash: p.scriptHash,
        wordCount: p.words.length,
        audioPath: p.audioPath,
      })),
    };
  }

  container.logger.info("Generation enqueued; draining worker queue", {
    sessionId,
    shortCount: touchedCandidateIds.size,
    includeFull: !shortsOnly,
  });

  await waitForDrain({
    container,
    sessionId,
    candidateIds: touchedCandidateIds,
    waitMs,
  });

  // Collect final YouTube IDs after drain.
  const finalSession =
    await container.repositories.replaySessions.getById(sessionId);
  const finalShorts: unknown[] = [];
  for (const candidateId of touchedCandidateIds) {
    const c = await container.repositories.candidates.getById(candidateId);
    if (!c) continue;
    finalShorts.push({
      candidateId,
      title: c.title,
      status: c.status,
      voiceOvers: (c.voiceOvers ?? []).map((v) => ({
        language: v.language,
        voiceProfile: v.voiceProfile,
        youtubeVideoId: v.youtubeVideoId,
        youtubeCaptionId: v.youtubeCaptionId ?? null,
        url: v.youtubeVideoId
          ? `https://youtu.be/${v.youtubeVideoId}`
          : null,
        renderOutputPath: v.renderOutputPath ?? null,
      })),
    });
  }

  report.finishedAt = new Date().toISOString();
  report.shortsFinal = finalShorts;
  report.fullFinal = {
    fullCanonical: finalSession?.fullVideoYoutubeId ?? null,
    fullVo: (finalSession?.fullVoiceOvers ?? []).map((v) => ({
      language: v.language,
      voiceProfile: v.voiceProfile,
      youtubeVideoId: v.youtubeVideoId,
      youtubeCaptionId: v.youtubeCaptionId ?? null,
      url: v.youtubeVideoId ? `https://youtu.be/${v.youtubeVideoId}` : null,
      wordCount: v.words.length,
    })),
  };

  const outPath = path.join(
    "media",
    `vo-final-regen-${sessionId.slice(0, 8)}.json`,
  );
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, reportPath: outPath, report }, null, 2));
  container.connection.close();
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
