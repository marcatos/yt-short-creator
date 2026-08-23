/**
 * Generate local sports-commentary assets (no YouTube upload).
 *
 * Usage:
 *   npx tsx scripts/generate-local-commentary.ts --session-id <uuid>
 *     [--voice-over-mode commentator|driver] [--regenerate-shorts] [--limit N]
 *     [--skip-encode]   Reuse existing full-youtube.mp4 when present
 */
import fs from "node:fs";
import path from "node:path";

import { loadEnv } from "../src/lib/env";
import { getContainer } from "../src/lib/container";
import { isReplayProvenance } from "../src/domain/replay";
import type { VoiceOverMode } from "../src/domain/commentary-style";
import type { ShortCandidate } from "../src/domain/entities";

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
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function asVoiceOverMode(value: string | undefined): VoiceOverMode {
  return value === "driver" ? "driver" : "commentator";
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJobs(
  container: ReturnType<typeof getContainer>,
  candidateIds: Set<string>,
  waitMs: number,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < waitMs) {
    const pending = container.jobQueue.listJobs().filter((job) => {
      if (!["queued", "running", "paused"].includes(job.status)) return false;
      if (job.type === "render_short") {
        return candidateIds.has(String(job.payload.candidateId ?? ""));
      }
      return false;
    });
    if (pending.length === 0) return;
    await sleep(3000);
  }
  throw new Error("Timed out waiting for short render jobs");
}

async function main(): Promise<void> {
  loadEnvLocal();
  const sessionId = argValue("--session-id");
  if (!sessionId) throw new Error("Missing --session-id");
  const voiceOverMode = asVoiceOverMode(argValue("--voice-over-mode"));
  const regenerateShorts = hasFlag("--regenerate-shorts");
  const skipEncode = hasFlag("--skip-encode");
  const limitRaw = argValue("--limit");
  const limit = limitRaw ? Number(limitRaw) : 2;

  loadEnv();
  const container = getContainer();
  await container.mediaStore.ensureDirs();

  const session = await container.repositories.replaySessions.getById(sessionId);
  if (!session?.mediaPath) {
    throw new Error(`Session not found or missing media: ${sessionId}`);
  }
  if (!session.raceAnalysis) {
    throw new Error("Run AV analysis first (raceAnalysis missing)");
  }

  container.logger.info("Local commentary generation started", {
    sessionId,
    mediaPath: session.mediaPath,
    voiceOverMode,
    regenerateShorts,
    limit,
  });

  let encodePath = session.fullVideoEncodePath;
  if (!encodePath || !skipEncode) {
    encodePath = (
      await container.fullVideoEncode.encode({
        sourceMediaPath: session.mediaPath,
        outputPath: container.mediaStore.fullReplayEncodePath(sessionId),
      })
    ).outputPath;
  }

  await container.repositories.replaySessions.save({
    ...session,
    fullVideoEncodePath: encodePath,
    updatedAt: container.clock.now(),
  });

  const packages = await container.generateFullVoiceOvers({
    sessionId,
    voiceOverMode,
    regenerate: true,
  });

  const bundle = await container.packageFullDeliveryAssets({
    sessionId,
    masterSourcePath: encodePath,
    voiceOvers: packages,
    analysis: session.raceAnalysis,
  });

  const touchedCandidateIds = new Set<string>();
  const shortOutputs: Array<Record<string, unknown>> = [];

  if (regenerateShorts) {
    const all = await container.repositories.candidates.list({});
    let candidates = all.filter(
      (c) =>
        isReplayProvenance(c.provenance) &&
        c.provenance.replaySessionId === sessionId,
    );
    candidates.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (Number.isFinite(limit) && limit > 0) {
      candidates = candidates.slice(0, limit);
    }

    for (const candidate of candidates) {
      touchedCandidateIds.add(candidate.id);
      const reset: ShortCandidate = {
        ...candidate,
        status: "proposed",
        voiceOvers: [],
        renderOutputPath: null,
        updatedAt: container.clock.now(),
      };
      await container.repositories.candidates.save(reset);
      await container.generateShortVoiceOvers({ candidateId: candidate.id });
      await container.approveCandidate({ candidateId: candidate.id });
    }

    await waitForJobs(container, touchedCandidateIds, 60 * 60 * 1000);

    for (const candidateId of touchedCandidateIds) {
      const fresh = await container.repositories.candidates.getById(candidateId);
      if (!fresh) continue;
      shortOutputs.push({
        candidateId,
        title: fresh.title,
        renders: (fresh.voiceOvers ?? []).map((vo) => ({
          language: vo.language,
          renderOutputPath: vo.renderOutputPath,
        })),
      });
    }
  }

  const deliveryDir = container.mediaStore.replayDeliveryDir?.(sessionId) ?? null;
  const report = {
    sessionId,
    voiceOverMode,
    sourceMedia: session.mediaPath,
    encodePath,
    deliveryDir,
    masterVideoPath: bundle.masterVideoPath,
    mixedAudio: {
      it: bundle.audioItPath,
      en: bundle.audioEnPath,
    },
    subtitles: {
      it: bundle.subtitlesItPath,
      en: bundle.subtitlesEnPath,
    },
    voiceOvers: packages.map((pkg) => ({
      language: pkg.language,
      audioPath: pkg.audioPath,
      srtPath: pkg.srtPath,
      title: pkg.title,
      voiceProfile: pkg.voiceProfile,
      scriptHash: pkg.scriptHash,
    })),
    shorts: shortOutputs,
    finishedAt: new Date().toISOString(),
  };

  const reportPath = path.join(
    deliveryDir ?? process.cwd(),
    `local-commentary-${voiceOverMode}.json`,
  );
  await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  container.connection.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
