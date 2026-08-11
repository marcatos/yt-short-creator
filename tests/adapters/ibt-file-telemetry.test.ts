import { describe, expect, it } from "vitest";

import { createIbtFileTelemetry } from "@/src/adapters/ibt/ibt-file-telemetry";
import type { Logger } from "@/src/ports/logger";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

describe("IbtFileTelemetry", () => {
  it("soft-fails on truncated files without throwing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yt-ibt-"));
    const ibtPath = path.join(dir, "tiny.ibt");
    await fs.writeFile(ibtPath, Buffer.alloc(8));
    const telemetry = createIbtFileTelemetry({ logger: createLogger() });
    await expect(telemetry.parse(ibtPath)).resolves.toEqual({
      events: [],
      trackName: null,
    });
    await fs.rm(dir, { recursive: true, force: true });
  });
});
