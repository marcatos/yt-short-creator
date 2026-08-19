/**
 * One-shot OBS race analysis: create media-only session + run AV pipeline.
 *
 * Usage:
 *   npx tsx scripts/analyze-obs-replay.ts --media "C:\path\file.mkv" [--title "..."] [--track "..."] [--notes "..."]
 *   npx tsx scripts/analyze-obs-replay.ts --session-id <uuid> [--notes-file path.txt]
 */
import fs from "node:fs";
import path from "node:path";

import { loadEnv } from "../src/lib/env";
import { createContainer } from "../src/lib/container";

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

async function main(): Promise<void> {
  loadEnvLocal();
  const sessionIdArg = argValue("--session-id");
  const mediaPath = argValue("--media");
  const title = argValue("--title");
  const trackName = argValue("--track");
  const notesInline = argValue("--notes");
  const notesFile = argValue("--notes-file");

  let operatorNotes: string | null = null;
  if (notesFile) {
    const absoluteNotes = path.resolve(notesFile);
    if (!fs.existsSync(absoluteNotes)) {
      throw new Error(`Notes file not found: ${absoluteNotes}`);
    }
    operatorNotes = fs.readFileSync(absoluteNotes, "utf8").trim();
  } else if (notesInline) {
    operatorNotes = notesInline.trim();
  }

  const env = loadEnv();
  const container = createContainer(env);
  await container.mediaStore.ensureDirs();

  let sessionId: string;
  if (sessionIdArg) {
    const existing = await container.repositories.replaySessions.getById(
      sessionIdArg,
    );
    if (!existing?.mediaPath) {
      throw new Error(`Session not found or missing media: ${sessionIdArg}`);
    }
    sessionId = existing.id;
    container.logger.info("Re-analyzing existing session", {
      sessionId,
      mediaPath: existing.mediaPath,
      hasOperatorNotes: Boolean(operatorNotes),
    });
  } else {
    if (!mediaPath) {
      throw new Error(
        'Missing --media "C:\\path\\to\\capture.mkv" (or pass --session-id)',
      );
    }
    const absoluteMedia = path.resolve(mediaPath);
    const session = await container.createReplaySession({
      mediaPath: absoluteMedia,
      title: title ?? undefined,
      trackName: trackName ?? null,
    });
    await container.attachReplayMedia({
      sessionId: session.id,
      mediaPath: absoluteMedia,
    });
    sessionId = session.id;
    container.logger.info("Starting AV analysis for OBS media", {
      sessionId,
      mediaPath: absoluteMedia,
      hasOperatorNotes: Boolean(operatorNotes),
    });
  }

  const candidates = await container.runReplayAnalysis({
    sessionId,
    operatorNotes,
  });
  const refreshed =
    (await container.repositories.replaySessions.getById(sessionId)) ?? null;

  const summary = {
    sessionId,
    candidateCount: candidates.length,
    title: refreshed?.racePackage?.fullVideo.title ?? null,
    description: refreshed?.racePackage?.fullVideo.description ?? null,
    tags: refreshed?.racePackage?.fullVideo.tags ?? [],
    transcript: refreshed?.racePackage?.transcript ?? null,
    shorts: candidates.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      score: candidate.score,
      startMs:
        "startMs" in candidate.provenance
          ? candidate.provenance.startMs
          : null,
      endMs:
        "endMs" in candidate.provenance ? candidate.provenance.endMs : null,
      segments:
        "segments" in candidate.provenance
          ? candidate.provenance.segments
          : undefined,
    })),
  };

  container.logger.info("OBS AV analysis finished", {
    sessionId,
    candidateCount: candidates.length,
  });
  console.log(JSON.stringify(summary, null, 2));
  container.connection.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
