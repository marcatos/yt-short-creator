/**
 * One-off: append full-video links to already-published clip Shorts.
 * Usage: npx tsx scripts/backfill-full-video-links.ts
 */
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { google } from "googleapis";

import { withFullVideoLink } from "../src/domain/full-video-link";

type TokenFile = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

type PublishedRow = {
  candidateId: string;
  title: string;
  description: string;
  provenance: string;
  shortYoutubeId: string;
};

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

async function main(): Promise<void> {
  loadEnvLocal();
  const clientId = process.env.YOUTUBE_CLIENT_ID ?? "";
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    throw new Error("YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET missing in env");
  }

  const db = new Database(path.resolve("data/app.db"));
  const tokenPath = path.resolve("data/youtube-tokens.json");
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`Missing tokens at ${tokenPath}; Connect YouTube first`);
  }
  const stored = JSON.parse(fs.readFileSync(tokenPath, "utf8")) as TokenFile;

  const oauth = new google.auth.OAuth2(
    clientId,
    clientSecret,
    process.env.YOUTUBE_REDIRECT_URI,
  );
  oauth.setCredentials({
    access_token: stored.accessToken,
    refresh_token: stored.refreshToken,
    expiry_date: new Date(stored.expiresAt).getTime(),
  });
  oauth.on("tokens", (tokens) => {
    const next: TokenFile = {
      accessToken: tokens.access_token ?? stored.accessToken,
      refreshToken: tokens.refresh_token ?? stored.refreshToken,
      expiresAt: new Date(
        tokens.expiry_date ?? Date.now() + 3_600_000,
      ).toISOString(),
    };
    fs.writeFileSync(tokenPath, `${JSON.stringify(next, null, 2)}\n`);
  });

  const youtube = google.youtube({ version: "v3", auth: oauth });

  const rows = db
    .prepare(
      `SELECT sc.id AS candidateId, sc.title, sc.description, sc.provenance,
              pj.youtube_video_id AS shortYoutubeId
       FROM short_candidates sc
       JOIN publish_jobs pj ON pj.candidate_id = sc.id
       WHERE sc.status = 'published'
         AND sc.origin = 'clip'
         AND pj.status = 'succeeded'
         AND pj.youtube_video_id IS NOT NULL`,
    )
    .all() as PublishedRow[];

  console.log(`Found ${rows.length} published clip Short(s)`);

  for (const row of rows) {
    const provenance = JSON.parse(row.provenance) as { sourceVideoId?: string };
    if (!provenance.sourceVideoId) {
      console.warn(`Skip ${row.shortYoutubeId}: no sourceVideoId`);
      continue;
    }
    const source = db
      .prepare(
        `SELECT youtube_video_id AS youtubeVideoId FROM source_videos WHERE id = ?`,
      )
      .get(provenance.sourceVideoId) as { youtubeVideoId: string } | undefined;
    if (!source?.youtubeVideoId) {
      console.warn(
        `Skip ${row.shortYoutubeId}: source ${provenance.sourceVideoId} missing`,
      );
      continue;
    }

    const list = await youtube.videos.list({
      part: ["snippet"],
      id: [row.shortYoutubeId],
    });
    const snippet = list.data.items?.[0]?.snippet;
    if (!snippet?.title) {
      console.warn(`Skip ${row.shortYoutubeId}: video not found on YouTube`);
      continue;
    }

    const currentDescription = snippet.description ?? "";
    const nextDescription = withFullVideoLink(
      currentDescription,
      source.youtubeVideoId,
    );
    if (nextDescription === currentDescription) {
      console.log(
        `OK already linked: ${row.shortYoutubeId} → ${source.youtubeVideoId}`,
      );
      continue;
    }

    await youtube.videos.update({
      part: ["snippet"],
      requestBody: {
        id: row.shortYoutubeId,
        snippet: {
          title: snippet.title,
          description: nextDescription,
          categoryId: snippet.categoryId ?? "2",
          tags: snippet.tags ?? undefined,
          defaultLanguage: snippet.defaultLanguage ?? undefined,
        },
      },
    });

    const localDescription = withFullVideoLink(
      row.description,
      source.youtubeVideoId,
    );
    db.prepare(
      `UPDATE short_candidates SET description = ?, updated_at = ? WHERE id = ?`,
    ).run(localDescription, Math.floor(Date.now() / 1000), row.candidateId);

    console.log(
      `Updated ${row.shortYoutubeId} (${row.title}) → Full video: https://youtu.be/${source.youtubeVideoId}`,
    );
  }

  console.log("Done");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
