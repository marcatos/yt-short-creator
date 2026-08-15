import type { RunClipAnalysis } from "@/src/application/run-clip-analysis";
import type { InspirationConfig } from "@/src/domain/inspiration-config";
import type { ShortCandidate } from "@/src/domain/entities";
import type { Logger } from "@/src/ports/logger";

export type MatchPair = {
  sourceVideoId: string;
  ideaId: string;
};

export type RunIdeationFill = (input: {
  channelId: string;
  ideaIds: string[];
  shortfall: number;
  matchedIdeaIds: string[];
}) => Promise<ShortCandidate[]>;

export type RunMatchProposeShorts = (input: {
  pairs: MatchPair[];
  channelId: string;
  onProgress?: (pct: number, message: string) => void | Promise<void>;
}) => Promise<{
  candidates: ShortCandidate[];
  successes: number;
  fillCount: number;
}>;

export function createRunMatchProposeShorts(deps: {
  runClipAnalysis: RunClipAnalysis;
  runIdeationFill: RunIdeationFill;
  logger: Logger;
  inspirationConfig?: InspirationConfig;
}): RunMatchProposeShorts {
  const log = deps.logger.child({ operation: "runMatchProposeShorts" });

  return async (input) => {
    const started = performance.now();
    log.info("Match propose started", {
      pairCount: input.pairs.length,
      channelId: input.channelId,
    });

    const all: ShortCandidate[] = [];
    const matchedIdeaIds = new Set<string>();
    let successes = 0;
    const totalPairs = Math.max(input.pairs.length, 1);

    for (let i = 0; i < input.pairs.length; i++) {
      const pair = input.pairs[i]!;
      await input.onProgress?.(
        Math.round((i / totalPairs) * 80),
        `Pair ${i + 1}/${input.pairs.length}`,
      );
      const pairStarted = performance.now();
      try {
        const created = await deps.runClipAnalysis({
          sourceVideoId: pair.sourceVideoId,
          ideaIds: [pair.ideaId],
        });
        all.push(...created);
        if (created.length > 0) {
          successes += 1;
          matchedIdeaIds.add(pair.ideaId);
        }
        log.info("Match pair completed", {
          ...pair,
          candidateCount: created.length,
          durationMs: Math.round(performance.now() - pairStarted),
        });
      } catch (error) {
        log.warn("Match pair failed; continuing", {
          ...pair,
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : String(error),
          durationMs: Math.round(performance.now() - pairStarted),
        });
      }
    }

    const fillMax = deps.inspirationConfig?.generateFillMax ?? 3;
    const quotaRatio = deps.inspirationConfig?.quotaRatio ?? 0.4;
    const target = Math.ceil(
      Math.max(all.length, input.pairs.length) * quotaRatio,
    );
    const selectedIdeaIds = input.pairs.map((pair) => pair.ideaId);
    const uncovered = selectedIdeaIds.filter((id) => !matchedIdeaIds.has(id));
    const shortfall = Math.max(
      0,
      target - matchedIdeaIds.size,
      uncovered.length > 0 ? uncovered.length : 0,
    );
    const fillCount = Math.min(fillMax, shortfall);

    let fill: ShortCandidate[] = [];
    if (fillCount > 0) {
      await input.onProgress?.(90, "Generate fill");
      const fillStarted = performance.now();
      fill = await deps.runIdeationFill({
        channelId: input.channelId,
        ideaIds: uncovered.length > 0 ? uncovered : selectedIdeaIds,
        shortfall: fillCount,
        matchedIdeaIds: [...matchedIdeaIds],
      });
      all.push(...fill);
      log.info("Match generate fill completed", {
        fillCount: fill.length,
        durationMs: Math.round(performance.now() - fillStarted),
      });
    }

    await input.onProgress?.(100, "Done");
    log.info("Match propose completed", {
      pairCount: input.pairs.length,
      successes,
      clipCandidates: all.length - fill.length,
      fillCandidates: fill.length,
      durationMs: Math.round(performance.now() - started),
    });

    if (successes === 0 && fill.length === 0) {
      throw new Error("Match propose produced no candidates");
    }

    return {
      candidates: all,
      successes,
      fillCount: fill.length,
    };
  };
}
