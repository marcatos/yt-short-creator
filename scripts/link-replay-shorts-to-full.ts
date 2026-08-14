/**
 * Link replay Shorts ↔ full race for one session:
 * - append "Full video:" on each Short description
 * - append a Shorts block on the full-race description
 *
 * Batches YouTube reads to save quota; safe to re-run (idempotent).
 *
 * Usage:
 *   npx tsx scripts/link-replay-shorts-to-full.ts --session-id <uuid>
 */
import fs from "node:fs";
import path from "node:path";

import { google } from "googleapis";

import { createContainer } from "../src/lib/container";
import { loadEnv } from "../src/lib/env";
import {
  withFullVideoLink,
  youtubeWatchUrl,
} from "../src/domain/full-video-link";
import { isReplayProvenance } from "../src/domain/replay";
import type { VoiceOverPackage } from "../src/domain/voice-over";

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

type TokenFile = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

type SnippetMap = Map<
  string,
  {
    title: string;
    description: string;
    categoryId?: string | null;
    tags?: string[] | null;
    defaultLanguage?: string | null;
  }
>;

function voYoutubeId(voiceOver: VoiceOverPackage): string | null {
  return voiceOver.youtubeVideoId?.trim() || null;
}

function isQuotaError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : JSON.stringify(error);
  return /exceeded your .*quota/i.test(message) || /quotaExceeded/i.test(message);
}

function appendShortsBlock(
  description: string,
  entries: Array<{ label: string; url: string }>,
): string {
  if (!entries.length) return description;
  const marker = "Shorts from this race:";
  if (description.toLowerCase().includes(marker.toLowerCase())) {
    return description;
  }
  const block = [
    marker,
    ...entries.map((entry) => `- ${entry.label}: ${entry.url}`),
  ].join("\n");
  const base = description.trim();
  return base ? `${base}\n\n${block}` : block;
}

async function listSnippets(
  youtube: ReturnType<typeof google.youtube>,
  ids: string[],
): Promise<SnippetMap> {
  const map: SnippetMap = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const list = await youtube.videos.list({
      part: ["snippet"],
      id: chunk,
    });
    for (const item of list.data.items ?? []) {
      if (!item.id || !item.snippet?.title) continue;
      map.set(item.id, {
        title: item.snippet.title,
        description: item.snippet.description ?? "",
        categoryId: item.snippet.categoryId,
        tags: item.snippet.tags,
        defaultLanguage: item.snippet.defaultLanguage,
      });
    }
  }
  return map;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const sessionId = argValue("--session-id");
  if (!sessionId) throw new Error("--session-id is required");

  const env = loadEnv();
  const container = createContainer(env);
  const log = container.logger.child({
    operation: "linkReplayShortsToFull",
    sessionId,
  });
  const startedAt = performance.now();

  const session = await container.repositories.replaySessions.getById(sessionId);
  if (!session?.fullVideoYoutubeId) {
    throw new Error(`Session missing fullVideoYoutubeId: ${sessionId}`);
  }
  const fullId = session.fullVideoYoutubeId;

  const tokenPath = path.resolve("data/youtube-tokens.json");
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`Missing tokens at ${tokenPath}`);
  }
  const stored = JSON.parse(fs.readFileSync(tokenPath, "utf8")) as TokenFile;
  const oauth = new google.auth.OAuth2(
    env.YOUTUBE_CLIENT_ID,
    env.YOUTUBE_CLIENT_SECRET,
    env.YOUTUBE_REDIRECT_URI,
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

  const all = await container.listCandidates({});
  const related = all.filter(
    (candidate) =>
      candidate.status === "published" &&
      isReplayProvenance(candidate.provenance) &&
      candidate.provenance.replaySessionId === sessionId,
  );

  const shortRefs: Array<{
    candidateId: string;
    language: string;
    shortId: string;
    label: string;
  }> = [];
  for (const candidate of related) {
    for (const voiceOver of candidate.voiceOvers ?? []) {
      const shortId = voYoutubeId(voiceOver);
      if (!shortId) continue;
      shortRefs.push({
        candidateId: candidate.id,
        language: voiceOver.language,
        shortId,
        label: `${voiceOver.language.toUpperCase()} — ${
          voiceOver.title || candidate.title
        }`.slice(0, 80),
      });
    }
  }

  const idsToFetch = [...new Set([fullId, ...shortRefs.map((ref) => ref.shortId)])];
  log.info("Linking Shorts to full race", {
    fullId,
    shortCount: shortRefs.length,
    fetchCount: idsToFetch.length,
  });

  let snippets: SnippetMap;
  try {
    snippets = await listSnippets(youtube, idsToFetch);
  } catch (error) {
    if (isQuotaError(error)) {
      log.error("YouTube quota exceeded before any updates", {
        durationMs: Math.round(performance.now() - startedAt),
      });
      throw error;
    }
    throw error;
  }

  let shortUpdates = 0;
  let shortSkipped = 0;
  let stoppedForQuota = false;

  for (const ref of shortRefs) {
    const snippet = snippets.get(ref.shortId);
    if (!snippet) {
      log.warn("Short missing on YouTube", { shortId: ref.shortId });
      continue;
    }
    const next = withFullVideoLink(snippet.description, fullId);
    if (next === snippet.description) {
      shortSkipped += 1;
      continue;
    }
    try {
      await youtube.videos.update({
        part: ["snippet"],
        requestBody: {
          id: ref.shortId,
          snippet: {
            title: snippet.title,
            description: next,
            categoryId: snippet.categoryId ?? "2",
            tags: snippet.tags ?? undefined,
            defaultLanguage: snippet.defaultLanguage ?? undefined,
          },
        },
      });
      shortUpdates += 1;
      snippet.description = next;
      log.info("Updated Short description", {
        shortId: ref.shortId,
        fullId,
      });
    } catch (error) {
      if (isQuotaError(error)) {
        stoppedForQuota = true;
        log.warn("YouTube quota exceeded mid Short updates; re-run later", {
          shortId: ref.shortId,
          remaining: shortRefs.length - shortUpdates - shortSkipped,
        });
        break;
      }
      throw error;
    }
  }

  for (const candidate of related) {
    const voiceOvers = (candidate.voiceOvers ?? []).map((voiceOver) => ({
      ...voiceOver,
      description: withFullVideoLink(voiceOver.description, fullId),
    }));
    await container.repositories.candidates.save({
      ...candidate,
      description: withFullVideoLink(candidate.description, fullId),
      voiceOvers,
      updatedAt: container.clock.now(),
    });
  }

  let fullResult: "updated" | "unchanged" | "skipped_quota" | "missing" =
    "unchanged";
  if (!stoppedForQuota) {
    const fullSnippet = snippets.get(fullId);
    if (!fullSnippet) {
      fullResult = "missing";
    } else {
      const nextFull = appendShortsBlock(
        fullSnippet.description,
        shortRefs.map((ref) => ({
          label: ref.label,
          url: youtubeWatchUrl(ref.shortId),
        })),
      );
      if (nextFull === fullSnippet.description) {
        fullResult = "unchanged";
      } else {
        try {
          await youtube.videos.update({
            part: ["snippet"],
            requestBody: {
              id: fullId,
              snippet: {
                title: fullSnippet.title,
                description: nextFull,
                categoryId: fullSnippet.categoryId ?? "2",
                tags: fullSnippet.tags ?? undefined,
                defaultLanguage: fullSnippet.defaultLanguage ?? undefined,
              },
            },
          });
          fullResult = "updated";
        } catch (error) {
          if (isQuotaError(error)) {
            stoppedForQuota = true;
            fullResult = "skipped_quota";
            log.warn("YouTube quota exceeded before full description update");
          } else {
            throw error;
          }
        }
      }
    }
  } else {
    fullResult = "skipped_quota";
  }

  const summary = {
    sessionId,
    fullId,
    shortCandidates: related.length,
    shortYoutubeIds: shortRefs.length,
    shortUpdates,
    shortSkipped,
    fullDescription: fullResult,
    stoppedForQuota,
    durationMs: Math.round(performance.now() - startedAt),
  };
  log.info("Link Shorts↔full finished", summary);
  console.log(JSON.stringify(summary, null, 2));
  container.connection.close();
  if (stoppedForQuota) process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
