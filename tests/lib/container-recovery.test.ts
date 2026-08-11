import { describe, expect, it, vi } from "vitest";

import { recoverThenStartWorkers } from "@/src/lib/container";
import type { Logger } from "@/src/ports/logger";

function createTestLogger(): Logger & {
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => logger,
  };
  return logger as typeof logger & {
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

describe("recoverThenStartWorkers", () => {
  it("starts the runner even when recovery throws", async () => {
    const logger = createTestLogger();
    const start = vi.fn();
    const recoverQueue = vi.fn().mockRejectedValue(new Error("db is locked"));

    await recoverThenStartWorkers(recoverQueue, { start }, logger);

    expect(start).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Queue recovery failed; starting workers anyway",
      expect.objectContaining({ error: "db is locked" }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("starts the runner normally when recovery succeeds", async () => {
    const logger = createTestLogger();
    const start = vi.fn();
    const recoverQueue = vi
      .fn()
      .mockResolvedValue({ requeuedRunning: 0, repairedCandidates: 0 });

    await recoverThenStartWorkers(recoverQueue, { start }, logger);

    expect(start).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
