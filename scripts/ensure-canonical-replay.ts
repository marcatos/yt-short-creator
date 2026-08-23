/**
 * Ensure the canonical HUD test replay is attached to its session.
 *
 * Usage: npx tsx scripts/ensure-canonical-replay.ts
 */
import fs from "node:fs";
import path from "node:path";

import { loadEnv } from "../src/lib/env";
import { getContainer } from "../src/lib/container";
import {
  loadCanonicalReplayConfig,
  pathsMatch,
  resolveCanonicalMediaPath,
} from "../src/domain/canonical-replay";
import {
  isReplayAnalysisStale,
  stripReplayDerivedArtifacts,
} from "../src/domain/replay-media-sync";

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

async function main(): Promise<void> {
  loadEnvLocal();
  loadEnv();
  const config = loadCanonicalReplayConfig();
  const mediaPath = resolveCanonicalMediaPath();
  const container = getContainer();

  const session = await container.repositories.replaySessions.getById(
    config.sessionId,
  );
  if (!session) {
    throw new Error(`Canonical replay session not found: ${config.sessionId}`);
  }

  let current = session;
  if (!session.mediaPath || !pathsMatch(session.mediaPath, mediaPath)) {
    current = await container.attachReplayMedia({
      sessionId: config.sessionId,
      mediaPath,
    });
  } else if (isReplayAnalysisStale(session)) {
    current = stripReplayDerivedArtifacts(session);
    await container.repositories.replaySessions.save({
      ...current,
      updatedAt: container.clock.now(),
    });
    container.logger.warn("Cleared stale race analysis (duration mismatch with media)", {
      sessionId: config.sessionId,
      sessionDurationSec: session.durationSec,
      analysisDurationSec: session.raceAnalysis?.context?.durationSec,
    });
  }

  const needsReanalysis = !current.raceAnalysis;
  const hudCount = current.raceAnalysis?.hudTimeline?.length ?? 0;
  const report = {
    sessionId: config.sessionId,
    label: config.label,
    mediaPath: current.mediaPath,
    canonicalMediaPath: mediaPath,
    mediaAttached: pathsMatch(current.mediaPath ?? "", mediaPath),
    trackName: current.trackName,
    analysisTrack: current.raceAnalysis?.context?.track ?? null,
    durationSec: current.durationSec,
    hasRaceAnalysis: Boolean(current.raceAnalysis),
    needsReanalysis,
    hudSnapshotCount: hudCount,
    encodePath: current.fullVideoEncodePath,
  };

  console.log(JSON.stringify(report, null, 2));
  container.connection.close();

  if (!report.mediaAttached) {
    throw new Error("Failed to attach canonical replay media");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
