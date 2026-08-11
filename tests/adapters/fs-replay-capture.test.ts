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

describe("FsReplayCapture", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it("returns the newest video created after since", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yt-replay-cap-"));
    dirs.push(dir);
    const capture = createFsReplayCapture({
      logger: createLogger(),
      pollIntervalMs: 50,
    });
    const since = new Date();
    const target = path.join(dir, "new-capture.mp4");

    const wait = capture.waitForNewRecording({
      watchDir: dir,
      since,
      timeoutMs: 3_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    await fs.writeFile(target, "fake");
    await expect(wait).resolves.toBe(target);
  });

  it("fails clearly when the watch folder is missing", async () => {
    const capture = createFsReplayCapture({ logger: createLogger() });
    await expect(
      capture.waitForNewRecording({
        watchDir: path.join(os.tmpdir(), "missing-iracing-videos-xyz"),
        since: new Date(),
        timeoutMs: 100,
      }),
    ).rejects.toThrow(/videos folder not found/i);
  });
});
