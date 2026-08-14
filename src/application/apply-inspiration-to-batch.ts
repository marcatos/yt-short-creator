import {
  parseInspirationConfig,
  type InspirationConfig,
} from "@/src/domain/inspiration-config";
import {
  alignmentScore,
  applyQuotaReorder,
  boostScore,
  matchIdeas,
  type InspirationIdea,
} from "@/src/domain/inspiration";
import type { ShortCandidate } from "@/src/domain/entities";
import type { ClockPort } from "@/src/ports/clock";
import type {
  CandidateInspirationLink,
  InspirationIdeaRecord,
  InspirationStorePort,
} from "@/src/ports/inspiration-store";
import type { Logger } from "@/src/ports/logger";

import { recordToInspirationIdea } from "./inspiration-prompt-block";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ApplyInspirationResult = {
  candidates: ShortCandidate[];
  shortfall: number;
  stale: boolean;
  matchedIdeaIds: string[];
};

type ApplyInspirationInput = {
  store: InspirationStorePort;
  config: InspirationConfig;
  clock: ClockPort;
  logger: Logger;
  candidates: ShortCandidate[];
  persistCandidates?: (candidates: ShortCandidate[]) => Promise<void>;
};

function candidateMatchText(candidate: ShortCandidate): string {
  const provenance = candidate.provenance;
  const hook = "hookReason" in provenance ? provenance.hookReason : "";
  return [candidate.title, candidate.description, hook]
    .filter(Boolean)
    .join(" ");
}

function isStale(
  latestOkSyncAt: Date | null,
  now: Date,
  staleDays: number,
): boolean {
  if (!latestOkSyncAt) {
    return true;
  }
  return now.getTime() - latestOkSyncAt.getTime() > staleDays * MS_PER_DAY;
}

function errorMeta(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { error: String(error) };
}

export async function applyInspirationToBatch(
  input: ApplyInspirationInput,
): Promise<ApplyInspirationResult> {
  const log = input.logger.child({ operation: "applyInspirationToBatch" });
  const startedAt = performance.now();
  const batchSize = input.candidates.length;

  log.info("Inspiration bias started", { candidateCount: batchSize });

  let records: InspirationIdeaRecord[];
  try {
    records = await input.store.listActiveIdeas();
  } catch (error) {
    log.warn("Inspiration bias failed; continuing without hard bias", {
      error: errorMeta(error),
      durationMs: Math.round(performance.now() - startedAt),
    });
    await input.persistCandidates?.(input.candidates);
    return {
      candidates: input.candidates,
      shortfall: 0,
      stale: false,
      matchedIdeaIds: [],
    };
  }

  if (records.length === 0) {
    log.info("inspiration_no_active_ideas", {
      candidateCount: batchSize,
      durationMs: Math.round(performance.now() - startedAt),
    });
    await input.persistCandidates?.(input.candidates);
    return {
      candidates: input.candidates,
      shortfall: 0,
      stale: false,
      matchedIdeaIds: [],
    };
  }

  const ideas = records.map(recordToInspirationIdea);
  let latestOkSyncAt: Date | null = null;
  try {
    latestOkSyncAt = await input.store.getLatestOkSyncAt();
  } catch (error) {
    log.warn("Inspiration freshness check failed; skipping hard bias", {
      error: errorMeta(error),
    });
    await input.persistCandidates?.(input.candidates);
    return {
      candidates: input.candidates,
      shortfall: 0,
      stale: true,
      matchedIdeaIds: [],
    };
  }
  const stale = isStale(
    latestOkSyncAt,
    input.clock.now(),
    input.config.staleDays,
  );

  if (stale) {
    log.warn("inspiration_stale", {
      latestOkSyncAt: latestOkSyncAt?.toISOString() ?? null,
      staleDays: input.config.staleDays,
      ideaCount: ideas.length,
      durationMs: Math.round(performance.now() - startedAt),
    });
    await input.persistCandidates?.(input.candidates);
    return {
      candidates: input.candidates,
      shortfall: 0,
      stale: true,
      matchedIdeaIds: [],
    };
  }

  const biased = applyFreshBias(input.candidates, ideas, input.config);
  await input.persistCandidates?.(biased.ordered);
  await persistLinks(
    input.store,
    input.candidates.map((candidate) => candidate.id),
    biased.links,
  );

  if (biased.shortfall > 0) {
    log.warn("inspiration_quota_shortfall", {
      shortfall: biased.shortfall,
      matchedCount: biased.matchedCount,
      candidateCount: batchSize,
      quotaRatio: input.config.quotaRatio,
    });
  }

  log.info("Inspiration bias completed", {
    candidateCount: batchSize,
    matchedCount: biased.matchedCount,
    shortfall: biased.shortfall,
    linkCount: biased.links.length,
    durationMs: Math.round(performance.now() - startedAt),
  });

  return {
    candidates: biased.ordered,
    shortfall: biased.shortfall,
    stale: false,
    matchedIdeaIds: biased.matchedIdeaIds,
  };
}

export async function applyInspirationToBatchIfConfigured(
  deps: {
    store?: InspirationStorePort;
    config?: InspirationConfig;
    clock: ClockPort;
    logger: Logger;
  },
  candidates: ShortCandidate[],
  persistCandidates?: (candidates: ShortCandidate[]) => Promise<void>,
): Promise<ApplyInspirationResult> {
  if (!deps.store) {
    await persistCandidates?.(candidates);
    return {
      candidates,
      shortfall: 0,
      stale: false,
      matchedIdeaIds: [],
    };
  }
  return applyInspirationToBatch({
    store: deps.store,
    config: deps.config ?? parseInspirationConfig({}),
    clock: deps.clock,
    logger: deps.logger,
    candidates,
    persistCandidates,
  });
}

async function persistLinks(
  store: InspirationStorePort,
  candidateIds: string[],
  links: CandidateInspirationLink[],
): Promise<void> {
  await store.deleteLinksForCandidates(candidateIds);
  await store.saveCandidateLinks(links);
}

function applyFreshBias(
  candidates: ShortCandidate[],
  ideas: InspirationIdea[],
  config: InspirationConfig,
): {
  ordered: ShortCandidate[];
  shortfall: number;
  matchedCount: number;
  matchedIdeaIds: string[];
  links: CandidateInspirationLink[];
} {
  const links: CandidateInspirationLink[] = [];
  const matchedIdeaIds = new Set<string>();
  const matchedIds = new Set<string>();

  const boosted = candidates.map((candidate) => {
    const text = candidateMatchText(candidate);
    const match = matchIdeas(text, ideas, config.matchMin);
    if (match.ideaIds.length === 0) {
      return candidate;
    }

    matchedIds.add(candidate.id);
    for (const ideaId of match.ideaIds) {
      matchedIdeaIds.add(ideaId);
      const idea = ideas.find((item) => item.id === ideaId);
      links.push({
        candidateId: candidate.id,
        ideaId,
        alignmentScore: idea ? alignmentScore(text, idea) : match.alignmentScore,
      });
    }

    return {
      ...candidate,
      score: boostScore(candidate.score, match.alignmentScore, config.scoreBoost),
    };
  });

  const { ordered, shortfall } = applyQuotaReorder(
    boosted,
    (candidate) => matchedIds.has(candidate.id),
    boosted.length,
    config.quotaRatio,
  );

  return {
    ordered,
    shortfall,
    matchedCount: ordered.filter((candidate) => matchedIds.has(candidate.id))
      .length,
    matchedIdeaIds: [...matchedIdeaIds],
    links,
  };
}
