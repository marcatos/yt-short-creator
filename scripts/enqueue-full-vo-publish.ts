/**
 * Enqueue single-master multilingual full-race publish (unlisted by default).
 *
 * Usage:
 *   npx tsx scripts/enqueue-full-vo-publish.ts --session-id <uuid> [--privacy unlisted] [--scheduled-at ISO]
 */
import fs from "node:fs";
import path from "node:path";

import { loadEnv } from "../src/lib/env";
import { createContainer } from "../src/lib/container";
import type { YoutubePrivacy } from "../src/domain/entities";

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

function asPrivacy(value: string | undefined): YoutubePrivacy {
  if (value === "public" || value === "private" || value === "unlisted") {
    return value;
  }
  return "unlisted";
}

function asScheduledAt(value: string | undefined): Date | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --scheduled-at: ${value}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const sessionId = argValue("--session-id");
  if (!sessionId) throw new Error("Missing --session-id");
  const privacy = asPrivacy(argValue("--privacy"));
  const scheduledAt = asScheduledAt(argValue("--scheduled-at"));
  const env = loadEnv();
  const container = createContainer(env);
  const session = await container.repositories.replaySessions.getById(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  console.log(
    JSON.stringify(
      {
        sessionId,
        hasRaceAnalysis: Boolean(session.raceAnalysis),
        whyWatch: session.raceAnalysis?.whyWatch ?? null,
        mainStoryline: session.raceAnalysis?.mainStoryline ?? null,
        shortCount: session.raceAnalysis?.shortCandidates.length ?? 0,
        youtubeIdBefore: session.fullVideoYoutubeId,
        scheduledAt: scheduledAt?.toISOString() ?? null,
      },
      null,
      2,
    ),
  );
  const result = await container.requestFullReplayPublish({
    sessionId,
    privacy,
    voiceOver: true,
    scheduledAt,
  });
  console.log(
    JSON.stringify(
      {
        enqueued: result,
        privacy,
        voiceOver: true,
        scheduledAt: scheduledAt?.toISOString() ?? null,
      },
      null,
      2,
    ),
  );
  container.connection.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
