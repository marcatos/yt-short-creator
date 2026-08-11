import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFsReplayCapture } from "@/src/adapters/replay/fs-replay-capture";
import type { Logger } from "@/src/ports/logger";

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

describe("FsReplayCapture directedCapture", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it("records each directed shot and concatenates the highlight", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yt-director-"));
    dirs.push(dir);
    const rpyPath = path.join(dir, "race.rpy");
    await fs.writeFile(rpyPath, "fake-rpy");
    const videosDir = path.join(dir, "videos");
    await fs.mkdir(videosDir);
    const outputPath = path.join(dir, "highlight.mp4");
    const calls: string[] = [];
    let segment = 0;

    const capture = createFsReplayCapture({
      logger: createLogger(),
      pollIntervalMs: 30,
      loadSettleMs: 5,
      stopSettleMs: 5,
      shotSettleMs: 5,
      simWaitMs: 500,
      minRecordDurationMs: 10,
      broadcast: {
        async send(msg, var1 = 0, var2 = 0, var3 = 0) {
          calls.push(`send:${msg}:${var1}:${var2}:${var3}`);
        },
        async sendWithVar2_32(msg, var1, var2_32) {
          calls.push(`send32:${msg}:${var1}:${var2_32}`);
        },
      },
      sim: {
        async openReplay(pathArg) {
          calls.push(`open:${pathArg}`);
        },
        async waitUntilRunning() {
          calls.push("sim-running");
        },
        async sleep(ms) {
          calls.push(`sleep:${ms}`);
          if (ms >= 80) {
            segment += 1;
            await fs.writeFile(
              path.join(videosDir, `seg-${segment}.mp4`),
              `seg-${segment}`,
            );
          }
        },
      },
      concat: {
        async concat({ segmentPaths, outputPath: out }) {
          await fs.writeFile(out, segmentPaths.join("|"));
          return out;
        },
      },
    });

    const result = await capture.directedCapture({
      rpyPath,
      watchDir: videosDir,
      timeoutMs: 10_000,
      outputPath,
      shots: [
        {
          id: "s1",
          seekMs: 12_000,
          recordMs: 100,
          carPosition: 2,
          cameraGroup: 1,
          cameraNumber: 1,
        },
        {
          id: "s2",
          seekMs: -1,
          recordMs: 100,
          carPosition: 1,
          cameraGroup: 1,
          cameraNumber: 1,
        },
      ],
    });

    expect(result.mediaPath).toBe(outputPath);
    expect(result.segments).toHaveLength(2);
    expect(calls.some((call) => call.startsWith("send32:12:0:12000"))).toBe(
      true,
    );
    expect(calls.some((call) => call.startsWith("send:5:8:"))).toBe(true);
    expect(calls.some((call) => call.startsWith("send:0:2:1:1"))).toBe(true);
  });
});
