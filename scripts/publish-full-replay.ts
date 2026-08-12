/**
 * Encode OBS/master race to YouTube delivery bitrate and upload (full video, not Short).
 *
 * Usage:
 *   npx tsx scripts/publish-full-replay.ts --session-id <uuid> [--privacy unlisted|public|private]
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

async function main(): Promise<void> {
  loadEnvLocal();
  const sessionId = argValue("--session-id");
  if (!sessionId) {
    throw new Error("Missing --session-id");
  }
  const privacy = asPrivacy(argValue("--privacy"));
  const env = loadEnv();
  const container = createContainer(env);
  await container.mediaStore.ensureDirs();

  const session = await container.repositories.replaySessions.getById(sessionId);
  if (!session?.mediaPath) {
    throw new Error(`Session missing or no media: ${sessionId}`);
  }
  const meta = session.racePackage?.fullVideo;
  if (!meta?.title) {
    throw new Error("Run AV analysis first (missing racePackage.fullVideo)");
  }

  container.logger.info("Full replay publish started", {
    sessionId,
    privacy,
    mediaPath: session.mediaPath,
  });

  const outputPath = container.mediaStore.fullReplayEncodePath(sessionId);
  const encoded = await container.fullVideoEncode.encode({
    sourceMediaPath: session.mediaPath,
    outputPath,
  });

  await container.repositories.replaySessions.save({
    ...session,
    fullVideoEncodePath: encoded.outputPath,
    fullVideoPrivacy: privacy,
    updatedAt: container.clock.now(),
  });

  if (session.fullVideoYoutubeId) {
    console.log(
      JSON.stringify(
        {
          sessionId,
          skippedUpload: true,
          youtubeVideoId: session.fullVideoYoutubeId,
          encodePath: encoded.outputPath,
          reusedEncode: encoded.reused,
        },
        null,
        2,
      ),
    );
    container.connection.close();
    return;
  }

  const tokens = await container.auth.getStoredTokens();
  if (!tokens) throw new Error("YouTube is not connected (no tokens)");
  let accessToken = tokens.accessToken;
  if (tokens.expiresAt.getTime() <= Date.now() + 60_000) {
    const refreshed = await container.auth.refreshAccessToken(tokens.refreshToken);
    await container.auth.saveTokens({
      ...tokens,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    });
    accessToken = refreshed.accessToken;
  }

  const description = [
    meta.description,
    "",
    session.racePackage?.transcript
      ? `---\nTranscript di gara\n${session.racePackage.transcript}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const uploaded = await container.upload.upload({
    accessToken,
    filePath: encoded.outputPath,
    title: meta.title.slice(0, 100),
    description,
    tags: meta.tags.slice(0, 15),
    scheduledAt: null,
    privacy,
    contentKind: "full",
  });

  await container.repositories.replaySessions.save({
    ...(await container.repositories.replaySessions.getById(sessionId))!,
    fullVideoEncodePath: encoded.outputPath,
    fullVideoYoutubeId: uploaded.youtubeVideoId,
    fullVideoPrivacy: privacy,
    fullVideoPublishedAt: container.clock.now(),
    updatedAt: container.clock.now(),
  });

  container.logger.info("Full replay publish completed", {
    sessionId,
    youtubeVideoId: uploaded.youtubeVideoId,
    reusedEncode: encoded.reused,
    encoderLabel: encoded.encoderLabel,
    videoBitrateMbps: encoded.videoBitrateMbps,
  });

  console.log(
    JSON.stringify(
      {
        sessionId,
        youtubeVideoId: uploaded.youtubeVideoId,
        url: `https://youtu.be/${uploaded.youtubeVideoId}`,
        privacy,
        encodePath: encoded.outputPath,
        reusedEncode: encoded.reused,
        encoderLabel: encoded.encoderLabel,
        videoBitrateMbps: encoded.videoBitrateMbps,
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
