/**
 * Force NEW publish_short jobs for already-rendered VO Shorts.
 * Clears sidecars + YT ids and does not reuse prior succeeded publish jobs.
 */
import fs from "node:fs";
import path from "node:path";

import { createContainer } from "../src/lib/container";
import { loadEnv } from "../src/lib/env";
import type { VoiceOverLanguage } from "../src/domain/voice-over";

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

async function main(): Promise<void> {
  loadEnvLocal();
  const rawIds = argValue("--ids");
  if (!rawIds) throw new Error("Missing --ids");
  const ids = rawIds.split(",").map((id) => id.trim()).filter(Boolean);
  const container = createContainer(loadEnv());
  const languages: VoiceOverLanguage[] = ["it", "en"];

  for (const candidateId of ids) {
    for (const language of languages) {
      const sidecar = path.join(
        "media",
        "voice-overs",
        `vo-publish-${candidateId}-${language}.json`,
      );
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    }

    const found = await container.repositories.candidates.getById(candidateId);
    if (!found) throw new Error(`Missing ${candidateId}`);
    const packages = found.voiceOvers ?? [];
    const ready = {
      ...found,
      status: "ready" as const,
      voiceOvers: packages.map((voiceOver) => ({
        ...voiceOver,
        youtubeVideoId: null,
        youtubeCaptionId: null,
      })),
      updatedAt: new Date(),
    };
    await container.repositories.candidates.save(ready);

    const jobIds: string[] = [];
    for (const language of languages) {
      const voiceOver = packages.find((item) => item.language === language);
      if (!voiceOver?.renderOutputPath || !voiceOver.srtPath) {
        throw new Error(`Missing ${language} assets for ${candidateId}`);
      }
      const jobId = await container.jobQueue.enqueue({
        type: "publish_short",
        payload: {
          candidateId,
          language,
          filePath: voiceOver.renderOutputPath,
          srtPath: voiceOver.srtPath,
          title: voiceOver.title,
          description: voiceOver.description,
        },
      });
      jobIds.push(jobId);
    }
    console.log(JSON.stringify({ candidateId, jobIds }));
  }
  container.connection.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
