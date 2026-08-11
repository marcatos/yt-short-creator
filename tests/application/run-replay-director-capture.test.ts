import { describe, expect, it } from "vitest";

import { createRunReplayDirectorCapture } from "@/src/application/run-replay-director-capture";
import type {
  ReplaySession,
  ShortCandidate,
} from "@/src/domain/entities";
import type { Logger } from "@/src/ports/logger";

const now = new Date("2026-08-11T15:00:00.000Z");

function createLogger(): Logger {
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child: () => logger,
  };
  return logger;
}

describe("runReplayDirectorCapture", () => {
  it("builds a director plan, captures, and proposes highlight candidates", async () => {
    let session: ReplaySession = {
      id: "session-1",
      rpyPath: "C:/replays/race.rpy",
      ibtPath: "C:/telemetry/race.ibt",
      mediaPath: null,
      trackName: null,
      focusCarIdx: 0,
      title: "Monza",
      durationSec: 300,
      status: "draft",
      events: [],
      createdAt: now,
      updatedAt: now,
    };
    const candidates: ShortCandidate[] = [];

    const run = createRunReplayDirectorCapture({
      replaySessions: {
        async save(next) {
          session = next;
        },
        async getById(id) {
          return session.id === id ? session : null;
        },
        async list() {
          return [session];
        },
      },
      candidates: {
        async save(candidate) {
          candidates.push(candidate);
        },
        async getById(id) {
          return candidates.find((item) => item.id === id) ?? null;
        },
        async list() {
          return candidates;
        },
      },
      capture: {
        defaultVideosDir: () => "C:/videos",
        async waitForNewRecording() {
          throw new Error("unused");
        },
        async autoCapture() {
          throw new Error("unused");
        },
        async directedCapture(input) {
          expect(input.shots.length).toBeGreaterThan(0);
          return {
            mediaPath: input.outputPath,
            segments: input.shots.map((shot) => ({
              shotId: shot.id,
              path: `C:/videos/${shot.id}.mp4`,
              durationMs: shot.recordMs,
            })),
          };
        },
      },
      ibtTelemetry: {
        async parse() {
          return {
            trackName: "Monza",
            events: [
              {
                id: "e1",
                type: "incident",
                startMs: 50_000,
                endMs: 51_000,
                score: 0.9,
                title: "T1 spin",
                hookReason: "Slowdown",
              },
            ],
          };
        },
      },
      mediaDuration: {
        async probeDurationSec() {
          return 20;
        },
      },
      id: {
        generate: (() => {
          let n = 0;
          return () => `id-${++n}`;
        })(),
      },
      clock: { now: () => now },
      logger: createLogger(),
      mediaRoot: "C:/media",
    });

    const result = await run({ sessionId: "session-1" });
    expect(result.session.mediaPath).toContain("session-1-highlight.mp4");
    expect(result.session.trackName).toBe("Monza");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.origin).toBe("replay");
    expect(result.candidates[0]?.tags).toContain("director");
    expect(candidates).toHaveLength(1);
  });
});
