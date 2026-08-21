import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  raceHudSnapshotSchema,
  reconcileHudTimeline,
  type RaceHudSnapshot,
  type RaceHudTimeline,
} from "@/src/domain/race-hud";
import type { LlmPort, LlmUserPart } from "@/src/ports/llm";
import type { Logger } from "@/src/ports/logger";
import type { ProxyFrame } from "@/src/ports/media-proxy";
import type {
  RaceHudExtractInput,
  RaceHudExtractorPort,
} from "@/src/ports/race-hud-extractor";
import { z } from "zod";

/**
 * Normalized ROI for fixed burned-in overlay layout (16:9 OBS capture).
 * Values are fractions of frame width/height: { x, y, w, h }.
 * Calibrated against 2560×1440 broadcast overlays (session/focus/battle/standings
 * + bottom battle callout + field ticker).
 */
export const HUD_ROI = {
  session: { x: 0.2, y: 0.015, w: 0.6, h: 0.07 },
  focus: { x: 0.005, y: 0.04, w: 0.3, h: 0.22 },
  battle: { x: 0.005, y: 0.28, w: 0.3, h: 0.3 },
  standings: { x: 0.7, y: 0.04, w: 0.295, h: 0.45 },
  battleCallout: { x: 0.22, y: 0.78, w: 0.56, h: 0.14 },
  fieldTicker: { x: 0.05, y: 0.93, w: 0.9, h: 0.06 },
} as const;

const HUD_CHUNK_SIZE = 8;
/** Sample every Nth proxy frame for HUD extraction (cost control). */
const HUD_FRAME_STRIDE = 2;

const hudChunkSchema = z.object({
  snapshots: z.array(raceHudSnapshotSchema),
});

const nullableStringSchema = { type: ["string", "null"] } as const;
const nullableIntSchema = { type: ["integer", "null"] } as const;
const nullableNumberSchema = { type: ["number", "null"] } as const;

const focusSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  required: [
    "carNumber",
    "driverName",
    "position",
    "fieldSize",
    "lastLap",
    "bestLap",
    "gapToLeader",
    "deltaBest",
    "fuelPct",
    "sectors",
  ],
  properties: {
    carNumber: nullableIntSchema,
    driverName: nullableStringSchema,
    position: nullableIntSchema,
    fieldSize: nullableIntSchema,
    lastLap: nullableStringSchema,
    bestLap: nullableStringSchema,
    gapToLeader: nullableStringSchema,
    deltaBest: nullableStringSchema,
    fuelPct: nullableStringSchema,
    sectors: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["s1", "s2", "s3"],
      properties: {
        s1: nullableStringSchema,
        s2: nullableStringSchema,
        s3: nullableStringSchema,
      },
    },
  },
} as const;

const sessionSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  required: [
    "sessionType",
    "status",
    "trackName",
    "lap",
    "sessionTime",
    "flag",
  ],
  properties: {
    sessionType: nullableStringSchema,
    status: nullableStringSchema,
    trackName: nullableStringSchema,
    lap: nullableIntSchema,
    sessionTime: nullableStringSchema,
    flag: nullableStringSchema,
  },
} as const;

const battleCalloutSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["contestedPosition", "rows"],
  properties: {
    contestedPosition: nullableIntSchema,
    rows: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["carNumber", "driverName", "gapSec", "note"],
        properties: {
          carNumber: nullableIntSchema,
          driverName: nullableStringSchema,
          gapSec: nullableNumberSchema,
          note: nullableStringSchema,
        },
      },
    },
  },
} as const;

const fieldTickerSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["rows"],
  properties: {
    rows: {
      type: "array",
      maxItems: 15,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["position", "carNumber", "driverName", "gapText"],
        properties: {
          position: nullableIntSchema,
          carNumber: nullableIntSchema,
          driverName: nullableStringSchema,
          gapText: nullableStringSchema,
        },
      },
    },
  },
} as const;

const hudChunkJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["snapshots"],
  properties: {
    snapshots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "timeMs",
          "session",
          "focus",
          "battle",
          "standings",
          "battleCallout",
          "fieldTicker",
          "confidence",
        ],
        properties: {
          timeMs: { type: "integer", minimum: 0 },
          session: sessionSchema,
          focus: focusSchema,
          battle: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["rows"],
            properties: {
              rows: {
                type: "array",
                maxItems: 12,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["role", "carNumber", "driverName", "gapSec"],
                  properties: {
                    role: { type: "string", enum: ["ahead", "focus", "behind"] },
                    carNumber: nullableIntSchema,
                    driverName: nullableStringSchema,
                    gapSec: nullableNumberSchema,
                  },
                },
              },
            },
          },
          standings: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["rows"],
            properties: {
              rows: {
                type: "array",
                maxItems: 40,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "position",
                    "carNumber",
                    "driverName",
                    "gapText",
                    "positionDelta",
                  ],
                  properties: {
                    position: { type: "integer", minimum: 1 },
                    carNumber: nullableIntSchema,
                    driverName: nullableStringSchema,
                    gapText: nullableStringSchema,
                    positionDelta: nullableNumberSchema,
                  },
                },
              },
            },
          },
          battleCallout: battleCalloutSchema,
          fieldTicker: fieldTickerSchema,
          confidence: {
            type: "string",
            enum: ["verified", "inferred", "unknown"],
          },
        },
      },
    },
  },
} satisfies Record<string, unknown>;

type HudRoi = { x: number; y: number; w: number; h: number };

type LlmRaceHudExtractorDeps = {
  llm: LlmPort;
  logger: Logger;
  ffmpegPath?: string;
};

function chunkFrames<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function selectHudFrames(frames: ProxyFrame[]): ProxyFrame[] {
  if (frames.length === 0) return [];
  const selected: ProxyFrame[] = [];
  for (let i = 0; i < frames.length; i += HUD_FRAME_STRIDE) {
    selected.push(frames[i]!);
  }
  const last = frames[frames.length - 1]!;
  if (selected[selected.length - 1]?.timeMs !== last.timeMs) {
    selected.push(last);
  }
  return selected;
}

async function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  log: Logger,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-8_000);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(`ffmpeg HUD crop exited with code ${code}: ${stderr.trim()}`),
      );
    });
  });
}

function cropFilter(roi: HudRoi, label: string): string {
  // Expressions evaluated against input size (iw/ih).
  return `[0:v]crop=iw*${roi.w}:ih*${roi.h}:iw*${roi.x}:ih*${roi.y},scale=480:-1[${label}]`;
}

/**
 * Build a 2x3 collage of the six HUD panels for denser OCR-style reading.
 * Layout: session | focus
 *          battle | standings
 *          callout | ticker
 */
async function cropHudCollage(
  ffmpegPath: string,
  frame: ProxyFrame,
  outPath: string,
  log: Logger,
): Promise<boolean> {
  const filter = [
    cropFilter(HUD_ROI.session, "session"),
    cropFilter(HUD_ROI.focus, "focus"),
    cropFilter(HUD_ROI.battle, "battle"),
    cropFilter(HUD_ROI.standings, "standings"),
    cropFilter(HUD_ROI.battleCallout, "callout"),
    cropFilter(HUD_ROI.fieldTicker, "ticker"),
    "[session][focus][battle][standings][callout][ticker]xstack=inputs=6:layout=0_0|w0_0|0_h0|w0_h0|0_h0+h2|w0_h0+h2",
  ].join(";");

  try {
    await runFfmpeg(
      ffmpegPath,
      ["-y", "-i", frame.path, "-filter_complex", filter, "-frames:v", "1", outPath],
      log,
    );
    return true;
  } catch (error) {
    log.debug("HUD ROI collage failed; using full frame", {
      timeMs: frame.timeMs,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1_000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function dedupeSnapshots(snapshots: RaceHudSnapshot[]): RaceHudTimeline {
  const byTime = new Map<number, RaceHudSnapshot>();
  for (const snap of snapshots) {
    byTime.set(snap.timeMs, snap);
  }
  return [...byTime.values()].sort((a, b) => a.timeMs - b.timeMs);
}

export function createLlmRaceHudExtractor(
  deps: LlmRaceHudExtractorDeps,
): RaceHudExtractorPort {
  const log = deps.logger.child({ component: "LlmRaceHudExtractor" });
  const ffmpegPath = deps.ffmpegPath ?? "ffmpeg";

  return {
    async extract(input: RaceHudExtractInput): Promise<RaceHudTimeline> {
      const startedAt = performance.now();
      const frames = selectHudFrames(input.frames);
      if (!frames.length) {
        log.info("HUD extract skipped — no frames", {
          durationMs: Math.round(performance.now() - startedAt),
        });
        return [];
      }

      const cropDir = path.join(input.workDir, "hud-roi");
      await fs.mkdir(cropDir, { recursive: true });

      const snapshots: RaceHudSnapshot[] = [];
      const chunks = chunkFrames(frames, HUD_CHUNK_SIZE);
      let chunkIndex = 0;

      for (const chunk of chunks) {
        chunkIndex += 1;
        const chunkStarted = performance.now();
        const stampList = chunk
          .map((frame) => `${formatMs(frame.timeMs)} (${frame.timeMs}ms)`)
          .join(", ");

        const userParts: LlmUserPart[] = [
          {
            type: "text",
            text: [
              "Extract ONLY the burned-in race HUD overlays from each image.",
              "Panels (fixed layout):",
              "1) SESSION STRIP — top center: status (REPLAY/RACE/CHECKERED/COOL DOWN/FINISHED), track, lap, session time, flag (GREEN/YELLOW/CHECKERED/…).",
              "2) FOCUS CARD — top left: camera focus driver (#, name, P/field, last/best lap, gap, ΔBEST, FUEL, S1/S2/S3).",
              "3) BATTLE / RELATIVE — middle left: ahead / focus / behind with gap seconds.",
              "4) STANDINGS — top right: position list with gaps (LEADER or +Xs) and green/red position-change arrows → positionDelta (+gained / −lost / null).",
              "5) BATTLE CALLOUT — bottom center graphic like \"Battle for P2\" with 2–3 cars and interval gaps; null when absent.",
              "6) FIELD TICKER — bottom edge scrolling list of mid/back-field cars; only include rows clearly readable in this frame; null when absent.",
              "Images may be a 2x3 collage of those panels or a full frame.",
              "Ignore watermarks (e.g. SM), iRacing logos, and track-map dots — they are not HUD text panels.",
              "Return one snapshot per frame timestamp. Use null for unreadable fields or missing panels. NEVER invent numbers or names.",
              "gapSec: negative or positive seconds as shown (ahead usually negative).",
              "confidence=verified when text is clearly readable; unknown if panels missing; inferred only if partially readable.",
              `Frame timestamps in order: ${stampList}`,
            ].join("\n"),
          },
        ];

        for (const frame of chunk) {
          const collagePath = path.join(
            cropDir,
            `hud_${String(frame.timeMs).padStart(8, "0")}.jpg`,
          );
          const cropped = await cropHudCollage(
            ffmpegPath,
            frame,
            collagePath,
            log,
          );
          const imagePath = cropped ? collagePath : frame.path;
          userParts.push({
            type: "text",
            text: `HUD frame at ${formatMs(frame.timeMs)} (${frame.timeMs} ms)`,
          });
          userParts.push({ type: "image", imagePathOrUrl: imagePath });
        }

        try {
          const response = await deps.llm.complete({
            system:
              "Return JSON HUD snapshots for racing replay overlays. Be literal and truthful.",
            user: "",
            userParts,
            jsonSchema: hudChunkJsonSchema,
          });
          const parsed = hudChunkSchema.parse(JSON.parse(response));
          const allowedTimes = new Set(chunk.map((frame) => frame.timeMs));
          for (const snap of parsed.snapshots) {
            if (!allowedTimes.has(snap.timeMs)) continue;
            snapshots.push(snap);
          }
          log.info("HUD chunk extracted", {
            chunk: chunkIndex,
            totalChunks: chunks.length,
            frameCount: chunk.length,
            snapshotCount: parsed.snapshots.length,
            durationMs: Math.round(performance.now() - chunkStarted),
          });
        } catch (error) {
          log.warn("HUD chunk extract failed; continuing", {
            chunk: chunkIndex,
            totalChunks: chunks.length,
            error:
              error instanceof Error
                ? { message: error.message, stack: error.stack }
                : String(error),
            durationMs: Math.round(performance.now() - chunkStarted),
          });
        }
      }

      const timeline = reconcileHudTimeline(dedupeSnapshots(snapshots));
      log.info("HUD extract completed", {
        frameCount: frames.length,
        snapshotCount: timeline.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return timeline;
    },
  };
}
