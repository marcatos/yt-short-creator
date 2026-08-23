/**
 * Renders a local Shorts-format preview with animated burn-in captions.
 * Usage: npx tsx scripts/render-caption-preview.ts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { filterFilename } from "@/src/adapters/ffmpeg/ffmpeg-audio-filters";
import {
  buildAssKaraoke,
  SHORT_CAPTION_FONTS_DIR,
  type TimedWord,
} from "@/src/domain/voice-over";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "data", "caption-preview");
const DURATION_SEC = 5;

/** Sample phrase mimicking a race-overtake hook. */
const SAMPLE_WORDS: TimedWord[] = [
  { text: "Sorpasso", startMs: 300, endMs: 750 },
  { text: "pulito", startMs: 750, endMs: 1_150 },
  { text: "in", startMs: 1_150, endMs: 1_280 },
  { text: "curva", startMs: 1_280, endMs: 1_650 },
  { text: "3", startMs: 1_650, endMs: 1_900 },
  { text: "e", startMs: 2_100, endMs: 2_200 },
  { text: "sale", startMs: 2_200, endMs: 2_550 },
  { text: "in", startMs: 2_550, endMs: 2_680 },
  { text: "classifica", startMs: 2_680, endMs: 3_350 },
  { text: "fino", startMs: 3_550, endMs: 3_850 },
  { text: "al", startMs: 3_850, endMs: 3_980 },
  { text: "quinto", startMs: 3_980, endMs: 4_450 },
];

async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const assPath = path.join(OUT_DIR, "preview-captions.ass");
  const outputPath = path.join(OUT_DIR, "caption-style-preview.mp4");
  const assContents = buildAssKaraoke(SAMPLE_WORDS);
  await fs.writeFile(assPath, assContents, "utf8");

  const fontsDir = filterFilename(path.join(ROOT, SHORT_CAPTION_FONTS_DIR));
  const assEscaped = filterFilename(assPath);
  const filter = [
    `[0:v]drawbox=x=0:y=0:w=18:h=ih:color=0xE10600:t=fill[branded]`,
    `[branded]ass=filename='${assEscaped}':fontsdir='${fontsDir}'[outv]`,
  ].join(";");

  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x101214:s=1080x1920:d=${DURATION_SEC}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=220:duration=${DURATION_SEC}`,
    "-filter_complex",
    filter,
    "-map",
    "[outv]",
    "-map",
    "1:a",
    "-t",
    String(DURATION_SEC),
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "fast",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  console.log("Rendering caption preview…");
  const result = spawnSync("ffmpeg", args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`ffmpeg exited with code ${result.status ?? "unknown"}`);
  }

  console.log("\nPreview ready:");
  console.log(`  Video: ${outputPath}`);
  console.log(`  ASS:   ${assPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
