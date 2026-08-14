/**
 * Approve + publish top N short candidates from a replay session's latest RaceAnalysis.
 * Generates IT/EN VO first (bilingual Short pipeline), then approves (render → publish).
 *
 * Usage:
 *   npx tsx scripts/approve-top-shorts.ts --session-id <uuid> [--limit 5]
 */
import fs from "node:fs";
import path from "node:path";

import { createContainer } from "../src/lib/container";
import { loadEnv } from "../src/lib/env";
import type { RaceAnalysis } from "../src/domain/race-analysis";
import type { ShortCandidate } from "../src/domain/entities";
import { isReplayProvenance } from "../src/domain/replay";

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

function matchCandidate(
  candidates: ShortCandidate[],
  sessionId: string,
  title: string,
  startMs: number,
): ShortCandidate | undefined {
  const sessionProposed = candidates.filter((candidate) => {
    if (candidate.status !== "proposed") return false;
    if (!isReplayProvenance(candidate.provenance)) return false;
    return candidate.provenance.replaySessionId === sessionId;
  });

  const byTitle = sessionProposed
    .filter((candidate) => candidate.title === title)
    .sort((a, b) => {
      const aStart = isReplayProvenance(a.provenance) ? a.provenance.startMs : 0;
      const bStart = isReplayProvenance(b.provenance) ? b.provenance.startMs : 0;
      return Math.abs(aStart - startMs) - Math.abs(bStart - startMs);
    });
  if (byTitle[0]) return byTitle[0];

  // Analysis windows can be expanded/clamped or replaced by vision fills —
  // fall back to nearest startMs within 20s.
  const byStart = [...sessionProposed]
    .map((candidate) => {
      const candidateStart = isReplayProvenance(candidate.provenance)
        ? candidate.provenance.startMs
        : Number.POSITIVE_INFINITY;
      return {
        candidate,
        delta: Math.abs(candidateStart - startMs),
      };
    })
    .filter((entry) => entry.delta <= 20_000)
    .sort((a, b) => a.delta - b.delta);
  return byStart[0]?.candidate;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const env = loadEnv();
  const sessionId = argValue("--session-id");
  if (!sessionId) {
    throw new Error("--session-id is required");
  }
  const limit = Math.max(1, Number(argValue("--limit") ?? "5") || 5);

  const container = createContainer(env);
  const settings = await container.settings.get();
  if (settings.defaultPrivacy !== "unlisted") {
    await container.updateSettings({
      ...settings,
      defaultPrivacy: "unlisted",
    });
  }
  const privacy = (await container.settings.get()).defaultPrivacy;

  const session = await container.repositories.replaySessions.getById(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  const analysis = session.raceAnalysis as RaceAnalysis | null;
  if (!analysis?.shortCandidates?.length) {
    throw new Error(`Session has no raceAnalysis.shortCandidates: ${sessionId}`);
  }

  const ranked = [...analysis.shortCandidates]
    .sort((a, b) => b.shortScore - a.shortScore)
    .slice(0, limit);

  const allCandidates = await container.listCandidates({});
  const selected: ShortCandidate[] = [];
  const usedIds = new Set<string>();
  for (const short of ranked) {
    const match = matchCandidate(
      allCandidates,
      sessionId,
      short.recommendedTitleIt,
      short.startMs,
    );
    if (!match || usedIds.has(match.id)) continue;
    usedIds.add(match.id);
    selected.push(match);
  }

  // If analysis windows were filtered out (too short) and filled by vision,
  // top up from highest-scoring proposed DB candidates for this session.
  if (selected.length < limit) {
    const extras = allCandidates
      .filter((candidate) => {
        if (candidate.status !== "proposed") return false;
        if (!isReplayProvenance(candidate.provenance)) return false;
        if (candidate.provenance.replaySessionId !== sessionId) return false;
        return !usedIds.has(candidate.id);
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit - selected.length);
    for (const extra of extras) {
      usedIds.add(extra.id);
      selected.push(extra);
    }
  }

  if (selected.length === 0) {
    throw new Error(`No proposed DB candidates for session ${sessionId}`);
  }

  console.log(
    JSON.stringify(
      {
        sessionId,
        defaultPrivacy: privacy,
        selected: selected.map((c, i) => ({
          id: c.id,
          title: c.title,
          score: c.score,
          analysisScore: ranked[i]?.shortScore,
          requiresLocalizedRender: ranked[i]?.requiresLocalizedRender,
          startMs: isReplayProvenance(c.provenance)
            ? c.provenance.startMs
            : null,
        })),
      },
      null,
      2,
    ),
  );

  for (const candidate of selected) {
    console.log(`Generating VO for ${candidate.id}…`);
    await container.generateShortVoiceOvers({ candidateId: candidate.id });
    console.log(`Approving ${candidate.id}…`);
    const approved = await container.approveCandidate({
      candidateId: candidate.id,
    });
    console.log(
      JSON.stringify({
        candidateId: approved.id,
        status: approved.status,
        voiceOverCount: approved.voiceOvers?.length ?? 0,
      }),
    );
  }

  console.log(
    JSON.stringify({
      enqueued: selected.length,
      note: "Workers will render IT/EN then publish (defaultPrivacy).",
    }),
  );
  container.connection.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
