import { describe, expect, it, vi } from "vitest";

import { createRunMatchProposeShorts } from "@/src/application/run-match-propose-shorts";
import type { ShortCandidate } from "@/src/domain/entities";
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

function candidate(id: string, title: string): ShortCandidate {
  return {
    id,
    origin: "clip",
    status: "proposed",
    title,
    description: "d",
    tags: ["simracing"],
    score: 0.8,
    scheduledAt: null,
    renderOutputPath: null,
    provenance: {
      sourceVideoId: "v1",
      startMs: 0,
      endMs: 10000,
      hookReason: "hook",
    },
    createdAt: new Date("2026-08-15T12:00:00.000Z"),
    updatedAt: new Date("2026-08-15T12:00:00.000Z"),
  };
}

describe("runMatchProposeShorts", () => {
  it("runs clip analysis per pair then generate fill for uncovered ideas", async () => {
    const progress: Array<{ pct: number; message: string }> = [];
    const runClipAnalysis = vi.fn(async (input: { sourceVideoId: string; ideaIds?: string[] }) => {
      if (input.sourceVideoId === "v-fail") {
        throw new Error("boom");
      }
      if (input.ideaIds?.[0] === "i2") {
        return [];
      }
      return [candidate(`c-${input.sourceVideoId}`, `Clip for ${input.ideaIds?.[0]}`)];
    });
    const runIdeationFill = vi.fn(async () => [
      { ...candidate("c-fill", "Fill short"), origin: "generate" as const },
    ]);

    const run = createRunMatchProposeShorts({
      runClipAnalysis,
      runIdeationFill,
      logger: createLogger(),
      inspirationConfig: { matchMin: 0.25, scoreBoost: 0.12, quotaRatio: 0.4, staleDays: 7, generateFillMax: 3 },
    });

    const result = await run({
      channelId: "ch-1",
      pairs: [
        { sourceVideoId: "v1", ideaId: "i1" },
        { sourceVideoId: "v2", ideaId: "i2" },
        { sourceVideoId: "v-fail", ideaId: "i3" },
      ],
      onProgress: async (pct, message) => {
        progress.push({ pct, message });
      },
    });

    expect(runClipAnalysis).toHaveBeenCalledTimes(3);
    expect(runClipAnalysis).toHaveBeenCalledWith({
      sourceVideoId: "v1",
      ideaIds: ["i1"],
    });
    expect(runIdeationFill).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "ch-1",
        shortfall: expect.any(Number),
        matchedIdeaIds: ["i1"],
      }),
    );
    expect(result.successes).toBe(1);
    expect(result.fillCount).toBe(1);
    expect(result.candidates).toHaveLength(2);
    expect(progress.at(-1)?.pct).toBe(100);
  });

  it("throws when every pair fails and fill yields nothing", async () => {
    const run = createRunMatchProposeShorts({
      runClipAnalysis: async () => {
        throw new Error("nope");
      },
      runIdeationFill: async () => [],
      logger: createLogger(),
    });

    await expect(
      run({
        channelId: "ch-1",
        pairs: [{ sourceVideoId: "v1", ideaId: "i1" }],
      }),
    ).rejects.toThrow(/no candidates/i);
  });
});
