/**
 * Force re-render + re-upload of Short VO pairs after the VO duration fix.
 * Clears prior YouTube IDs / renders so publish does not skip as "already uploaded".
 *
 * Usage:
 *   npx tsx scripts/rerender-reupload-shorts.ts --ids id1,id2,...
 */
import fs from "node:fs";
import path from "node:path";

import { createContainer } from "../src/lib/container";
import { loadEnv } from "../src/lib/env";
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

function resetForRerender(candidate: ShortCandidate): ShortCandidate {
  const now = new Date();
  return {
    ...candidate,
    status: "approved",
    renderOutputPath: null,
    voiceOvers: (candidate.voiceOvers ?? []).map((voiceOver) => ({
      ...voiceOver,
      renderOutputPath: null,
      youtubeVideoId: null,
      youtubeCaptionId: null,
    })),
    updatedAt: now,
  };
}

async function main(): Promise<void> {
  loadEnvLocal();
  const rawIds = argValue("--ids");
  if (!rawIds) throw new Error("Missing --ids id1,id2,...");
  const ids = rawIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!ids.length) throw new Error("No candidate ids");

  const container = createContainer(loadEnv());
  const settings = await container.settings.get();
  if (settings.defaultPrivacy !== "unlisted") {
    await container.updateSettings({ ...settings, defaultPrivacy: "unlisted" });
  }

  const enqueued: Array<{ candidateId: string; renderJobIds: string[] }> = [];
  for (const candidateId of ids) {
    const found = await container.repositories.candidates.getById(candidateId);
    if (!found) throw new Error(`Candidate not found: ${candidateId}`);
    if (!(found.voiceOvers ?? []).some((v) => v.language === "it" && v.audioPath)) {
      throw new Error(`Candidate missing IT VO package: ${candidateId}`);
    }
    if (!(found.voiceOvers ?? []).some((v) => v.language === "en" && v.audioPath)) {
      throw new Error(`Candidate missing EN VO package: ${candidateId}`);
    }

    const reset = resetForRerender(found);
    await container.repositories.candidates.save(reset);

    // Drop stale 8s renders so we never re-upload the short cut.
    for (const language of ["it", "en"] as const) {
      const renderPath = container.mediaStore.voRenderPath?.(
        candidateId,
        language,
      );
      if (renderPath && fs.existsSync(renderPath)) {
        fs.unlinkSync(renderPath);
      }
      const sidecar = path.join(
        "media",
        "voice-overs",
        `vo-publish-${candidateId}-${language}.json`,
      );
      if (fs.existsSync(sidecar)) {
        fs.unlinkSync(sidecar);
      }
    }

    const renderJobIds = await Promise.all(
      (["it", "en"] as const).map((language) =>
        container.jobQueue.enqueue({
          type: "render_short",
          payload: { candidateId, language },
        }),
      ),
    );
    enqueued.push({ candidateId, renderJobIds });
    console.log(
      JSON.stringify({
        candidateId,
        title: reset.title,
        status: reset.status,
        renderJobIds,
        priorYoutube: (found.voiceOvers ?? []).map((v) => ({
          language: v.language,
          youtubeVideoId: v.youtubeVideoId ?? null,
        })),
      }),
    );
  }

  console.log(
    JSON.stringify(
      {
        count: enqueued.length,
        privacy: (await container.settings.get()).defaultPrivacy,
        note: "Workers will render (VO-aware duration) then publish IT+EN unlisted.",
      },
      null,
      2,
    ),
  );
  container.connection.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
