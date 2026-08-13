import fs from "node:fs";
import path from "node:path";

import { loadEnv } from "../src/lib/env";
import { createContainer } from "../src/lib/container";
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
    if (!(key in process.env) || !process.env[key]) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const SESSION = "3ba5532d-3812-4868-82e7-9053c90bbf12";
  const c = createContainer(loadEnv());
  const session = await c.repositories.replaySessions.getById(SESSION);
  const settings = await c.settings.get();
  const all = await c.repositories.candidates.list({});
  const cands = all.filter(
    (x) =>
      isReplayProvenance(x.provenance) &&
      x.provenance.replaySessionId === SESSION,
  );
  const out = {
    enableVo: settings.enableVoiceOverPipeline,
    itVoice: settings.italianVoiceProfile,
    enVoice: settings.brandVoiceProfile,
    burnIn: settings.shortsBurnInCaptions,
    duck: settings.voiceDuckDb,
    fullYt: session?.fullVideoYoutubeId ?? null,
    fullVo: (session?.fullVoiceOvers ?? []).map((v) => ({
      l: v.language,
      yt: v.youtubeVideoId,
      hash: v.scriptHash,
      words: v.words.length,
    })),
    cands: cands.map((x) => ({
      id: x.id,
      status: x.status,
      title: x.title,
      vo: (x.voiceOvers ?? []).map((v) => ({
        l: v.language,
        yt: v.youtubeVideoId,
        render: Boolean(v.renderOutputPath),
      })),
    })),
  };
  fs.writeFileSync("media/vo-state.json", JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        n: cands.length,
        enableVo: out.enableVo,
        voices: { it: out.itVoice, en: out.enVoice },
        burnIn: out.burnIn,
        statuses: Object.fromEntries(
          [...new Set(cands.map((c) => c.status))].map((s) => [
            s,
            cands.filter((c) => c.status === s).length,
          ]),
        ),
        withYt: cands.filter((c) =>
          (c.voiceOvers ?? []).some((v) => v.youtubeVideoId),
        ).length,
      },
      null,
      2,
    ),
  );
  c.connection.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
