import { describe, expect, it } from "vitest";

import { createRequestReplayCapture } from "@/src/application/request-replay-capture";
import type { ReplaySession } from "@/src/domain/entities";
import type { Logger } from "@/src/ports/logger";

const now = new Date("2026-08-11T14:00:00.000Z");

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

describe("requestReplayCapture", () => {
  it("runs autoCapture and stores the resulting media on the session", async () => {
    let session: ReplaySession = {
      id: "session-1",
      rpyPath: "C:/replays/race.rpy",
      ibtPath: null,
      mediaPath: null,
      trackName: "Spa",
      focusCarIdx: 0,
      title: "Spa race",
      durationSec: 60,
      status: "draft",
      events: [],
      createdAt: now,
      updatedAt: now,
    };
    const autoCalls: Array<Record<string, unknown>> = [];

    const request = createRequestReplayCapture({
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
      capture: {
        defaultVideosDir: () => "C:/videos",
        async waitForNewRecording() {
          throw new Error("should use autoCapture");
        },
        async autoCapture(input) {
          autoCalls.push(input);
          return "C:/videos/race.mp4";
        },
        async directedCapture() {
          throw new Error("should use autoCapture");
        },
      },
      mediaDuration: {
        async probeDurationSec() {
          return 58;
        },
      },
      clock: { now: () => now },
      logger: createLogger(),
    });

    const updated = await request({ sessionId: "session-1", playSpeed: 2 });
    expect(autoCalls).toHaveLength(1);
    expect(autoCalls[0]).toMatchObject({
      rpyPath: "C:/replays/race.rpy",
      playSpeed: 2,
      recordDurationMs: 35_000,
    });
    expect(updated.mediaPath).toBe("C:/videos/race.mp4");
    expect(updated.durationSec).toBe(58);
    expect(updated.status).toBe("ready");
  });
});
