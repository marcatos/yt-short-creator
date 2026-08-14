import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createLlmRaceHudExtractor, HUD_ROI } from "@/src/adapters/llm/llm-race-hud-extractor";
import type { Logger } from "@/src/ports/logger";

function createLogger(): Logger {
  const logger: Logger = {
    child: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger;
}

describe("llm-race-hud-extractor", () => {
  it("exposes six calibrated ROIs including callout and ticker", () => {
    expect(Object.keys(HUD_ROI).sort()).toEqual(
      [
        "battle",
        "battleCallout",
        "fieldTicker",
        "focus",
        "session",
        "standings",
      ].sort(),
    );
    expect(HUD_ROI.battleCallout.y).toBeGreaterThan(0.7);
    expect(HUD_ROI.fieldTicker.y).toBeGreaterThan(0.9);
  });

  it("parses extended HUD JSON and reconciles focus vs standings", async () => {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "hud-extract-"));
    const framePath = path.join(workDir, "frame.jpg");
    // Minimal JPEG so ffmpeg is not required when collage fails and full frame is used.
    await fs.writeFile(
      framePath,
      Buffer.from(
        "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z",
        "base64",
      ),
    );

    const extractor = createLlmRaceHudExtractor({
      logger: createLogger(),
      llm: {
        async complete() {
          return JSON.stringify({
            snapshots: [
              {
                timeMs: 0,
                session: {
                  sessionType: "RACE",
                  status: "REPLAY",
                  trackName: "Motorsport Arena Oschersleben",
                  lap: 5,
                  sessionTime: "2:14",
                  flag: "GREEN",
                },
                focus: {
                  carNumber: 7,
                  driverName: "Simone Marcato",
                  position: 4,
                  fieldSize: 19,
                  lastLap: "1:37.630",
                  bestLap: "1:38.242",
                  gapToLeader: "+6.99s",
                  deltaBest: "-0.71s",
                  fuelPct: "0%",
                  sectors: { s1: null, s2: null, s3: null },
                },
                battle: {
                  rows: [
                    {
                      role: "ahead",
                      carNumber: 2,
                      driverName: "Marcel Gorissen",
                      gapSec: -0.6,
                    },
                    {
                      role: "focus",
                      carNumber: 7,
                      driverName: "Simone Marcato",
                      gapSec: 0,
                    },
                  ],
                },
                standings: {
                  rows: [
                    {
                      position: 4,
                      carNumber: 7,
                      driverName: "Simone Marcato",
                      gapText: "+6.99s",
                      positionDelta: 1,
                    },
                  ],
                },
                battleCallout: {
                  contestedPosition: 2,
                  rows: [
                    {
                      carNumber: 7,
                      driverName: "S. Marcato",
                      gapSec: 0,
                      note: "SIDE",
                    },
                    {
                      carNumber: 2,
                      driverName: "M. Gorissen",
                      gapSec: 0.2,
                      note: null,
                    },
                  ],
                },
                fieldTicker: {
                  rows: [
                    {
                      position: 12,
                      carNumber: 12,
                      driverName: "Marino Separovic",
                      gapText: "+11.14s",
                    },
                  ],
                },
                confidence: "verified",
              },
            ],
          });
        },
      },
    });

    const timeline = await extractor.extract({
      frames: [{ timeMs: 0, path: framePath }],
      workDir,
    });

    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.battleCallout?.contestedPosition).toBe(2);
    expect(timeline[0]!.fieldTicker?.rows[0]?.carNumber).toBe(12);
    expect(timeline[0]!.focus?.deltaBest).toBe("-0.71s");
    expect(timeline[0]!.standings?.rows[0]?.positionDelta).toBe(1);
  });
});
