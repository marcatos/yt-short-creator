import { describe, expect, it } from "vitest";

import { applyInspirationToBatch } from "@/src/application/apply-inspiration-to-batch";
import {
  formatInspirationPromptBlock,
  loadInspirationPromptBlock,
} from "@/src/application/inspiration-prompt-block";
import type { InspirationConfig } from "@/src/domain/inspiration-config";
import type { ShortCandidate } from "@/src/domain/entities";
import type {
  CandidateInspirationLink,
  InspirationIdeaRecord,
  InspirationStorePort,
  InspirationSyncRun,
} from "@/src/ports/inspiration-store";
import type { Logger } from "@/src/ports/logger";

const now = new Date("2026-08-14T18:00:00.000Z");

const config: InspirationConfig = {
  matchMin: 0.25,
  scoreBoost: 0.12,
  quotaRatio: 0.4,
  staleDays: 7,
  generateFillMax: 3,
};

function capturingLogger() {
  const infos: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
  const warnings: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
  const logger: Logger = {
    debug() {},
    info(msg, ctx) {
      infos.push({ msg, ctx });
    },
    warn(msg, ctx) {
      warnings.push({ msg, ctx });
    },
    error() {},
    child: () => logger,
  };
  return { logger, infos, warnings };
}

class MemoryInspirationStore implements InspirationStorePort {
  ideas: InspirationIdeaRecord[] = [];
  latestOkSyncAt: Date | null = null;
  latestSuccessfulSyncAt: Date | null = null;
  links: CandidateInspirationLink[] = [];

  async saveSyncRun(): Promise<void> {}
  async listSyncRuns(): Promise<InspirationSyncRun[]> {
    return [];
  }
  async getLatestOkSyncAt(): Promise<Date | null> {
    return this.latestOkSyncAt;
  }
  async getLatestSuccessfulSyncAt(): Promise<Date | null> {
    return this.latestSuccessfulSyncAt ?? this.latestOkSyncAt;
  }
  async getLatestFinishedSyncAt(): Promise<Date | null> {
    return this.latestSuccessfulSyncAt ?? this.latestOkSyncAt;
  }
  async replaceActiveIdeas(): Promise<void> {}
  async listActiveIdeas(): Promise<InspirationIdeaRecord[]> {
    return this.ideas.filter((idea) => idea.active);
  }
  async deleteLinksForCandidates(ids: string[]): Promise<void> {
    const wanted = new Set(ids);
    this.links = this.links.filter((link) => !wanted.has(link.candidateId));
  }
  async saveCandidateLinks(links: CandidateInspirationLink[]): Promise<void> {
    for (const link of links) {
      const collision = this.links.some(
        (existing) =>
          existing.candidateId === link.candidateId &&
          existing.ideaId === link.ideaId,
      );
      if (collision) {
        throw new Error(
          `inspiration link PK collision: ${link.candidateId}/${link.ideaId}`,
        );
      }
      this.links.push(link);
    }
  }
  async listLinksForCandidates(
    ids: string[],
  ): Promise<CandidateInspirationLink[]> {
    const wanted = new Set(ids);
    return this.links.filter((link) => wanted.has(link.candidateId));
  }
}

function ideaRecord(
  overrides: Partial<InspirationIdeaRecord> & Pick<InspirationIdeaRecord, "id">,
): InspirationIdeaRecord {
  return {
    syncRunId: "run-1",
    externalKey: `ext-${overrides.id}`,
    title: "Oschersleben battle for P2",
    summary: "Door-to-door last laps at Oschersleben",
    audienceInterest: "sim racing",
    channelAlignment: "high",
    relatedInterest: null,
    outline: null,
    suggestedTitles: ["Last lap fight at Oschersleben"],
    thumbnailNotes: null,
    rawSnippet: null,
    capturedAt: now,
    active: true,
    ...overrides,
  };
}

function clipCandidate(
  overrides: Partial<ShortCandidate> & Pick<ShortCandidate, "id" | "title">,
): ShortCandidate {
  return {
    origin: "clip",
    status: "proposed",
    description: "A racing highlight.",
    tags: ["racing"],
    score: 0.8,
    provenance: {
      sourceVideoId: "source-1",
      startMs: 0,
      endMs: 15_000,
      hookReason: "Immediate battle tension",
      crop: { mode: "center_vertical", focusX: 0.5 },
    },
    renderOutputPath: null,
    scheduledAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function generateCandidate(
  overrides: Partial<ShortCandidate> & Pick<ShortCandidate, "id" | "title">,
): ShortCandidate {
  return {
    origin: "generate",
    status: "proposed",
    description: "Stay smooth.",
    tags: ["racing"],
    score: 0.7,
    provenance: {
      generationBriefId: "brief-1",
      scriptVersion: 1,
      voiceAssetPath: "",
      timeline: [],
    },
    renderOutputPath: null,
    scheduledAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("loadInspirationPromptBlock", () => {
  it("loads only ideas in ideaIds subset", async () => {
    const store = new MemoryInspirationStore();
    store.ideas = [
      ideaRecord({ id: "idea-1", title: "First idea" }),
      ideaRecord({ id: "idea-2", title: "Second idea" }),
    ];

    const block = await loadInspirationPromptBlock(store, ["idea-1"]);

    expect(block).toContain("First idea");
    expect(block).not.toContain("Second idea");
  });
});

describe("formatInspirationPromptBlock", () => {
  it("returns empty string when there are no ideas", () => {
    expect(formatInspirationPromptBlock([])).toBe("");
  });

  it("includes titles, summaries, and suggested titles", () => {
    const block = formatInspirationPromptBlock([
      {
        id: "i1",
        title: "Oschersleben battle for P2",
        summary: "Door-to-door last laps",
        suggestedTitles: ["Last lap fight"],
        outline: "",
      },
    ]);
    expect(block).toContain("Active YouTube Inspiration ideas");
    expect(block).toContain("Oschersleben battle for P2");
    expect(block).toContain("Door-to-door last laps");
    expect(block).toContain("Last lap fight");
    expect(block).toContain("Do not invent facts");
  });
});

describe("applyInspirationToBatch", () => {
  it("is a no-op when the store has no active ideas", async () => {
    const store = new MemoryInspirationStore();
    const { logger, infos } = capturingLogger();
    const candidates = [
      clipCandidate({ id: "c1", title: "Oschersleben last lap battle" }),
    ];

    const result = await applyInspirationToBatch({
      store,
      config,
      clock: { now: () => now },
      logger,
      candidates,
    });

    expect(result.candidates).toEqual(candidates);
    expect(result.shortfall).toBe(0);
    expect(result.stale).toBe(false);
    expect(store.links).toEqual([]);
    expect(infos.some((entry) => entry.msg === "inspiration_no_active_ideas")).toBe(
      true,
    );
  });

  it("boosts scores, reorders matched first, and saves links when ideas are fresh", async () => {
    const store = new MemoryInspirationStore();
    store.latestOkSyncAt = new Date("2026-08-13T18:00:00.000Z");
    store.ideas = [ideaRecord({ id: "idea-1" })];
    const { logger, warnings } = capturingLogger();
    const unmatched = clipCandidate({
      id: "c-unmatched",
      title: "How to cook pasta carbonara",
      description: "A kitchen tutorial with eggs and pecorino.",
      score: 0.95,
      provenance: {
        sourceVideoId: "source-1",
        startMs: 0,
        endMs: 15_000,
        hookReason: "Dinner tonight",
        crop: { mode: "center_vertical", focusX: 0.5 },
      },
    });
    const matched = clipCandidate({
      id: "c-matched",
      title: "Oschersleben last lap battle",
      description: "Door-to-door fight at Oschersleben",
      score: 0.7,
    });

    const result = await applyInspirationToBatch({
      store,
      config,
      clock: { now: () => now },
      logger,
      candidates: [unmatched, matched],
    });

    expect(result.stale).toBe(false);
    expect(result.shortfall).toBe(0);
    expect(result.candidates[0]?.id).toBe("c-matched");
    expect(result.candidates[0]?.score).toBeGreaterThan(0.7);
    expect(result.candidates[0]?.score).toBeLessThanOrEqual(1);
    expect(result.candidates[1]?.id).toBe("c-unmatched");
    expect(result.candidates[1]?.score).toBe(0.95);
    expect(store.links).toEqual([
      expect.objectContaining({
        candidateId: "c-matched",
        ideaId: "idea-1",
      }),
    ]);
    expect(
      warnings.some((entry) => entry.msg === "inspiration_quota_shortfall"),
    ).toBe(false);
  });

  it("skips boost, quota, and links when ideas are stale", async () => {
    const store = new MemoryInspirationStore();
    store.latestOkSyncAt = new Date("2026-08-01T18:00:00.000Z");
    store.ideas = [ideaRecord({ id: "idea-1" })];
    const { logger, warnings } = capturingLogger();
    const matched = clipCandidate({
      id: "c-matched",
      title: "Oschersleben last lap battle",
      description: "Door-to-door fight at Oschersleben",
      score: 0.7,
    });

    const result = await applyInspirationToBatch({
      store,
      config,
      clock: { now: () => now },
      logger,
      candidates: [matched],
    });

    expect(result.stale).toBe(true);
    expect(result.candidates[0]?.score).toBe(0.7);
    expect(store.links).toEqual([]);
    expect(warnings.some((entry) => entry.msg === "inspiration_stale")).toBe(
      true,
    );
  });

  it("warns on quota shortfall without inventing candidates", async () => {
    const store = new MemoryInspirationStore();
    store.latestOkSyncAt = new Date("2026-08-13T18:00:00.000Z");
    store.ideas = [ideaRecord({ id: "idea-1" })];
    const { logger, warnings } = capturingLogger();
    const candidates = [
      clipCandidate({
        id: "a",
        title: "How to cook pasta carbonara",
        description: "Eggs and pecorino.",
      }),
      clipCandidate({
        id: "b",
        title: "Folding laundry tips",
        description: "Towels and shirts.",
      }),
      clipCandidate({
        id: "c",
        title: "Indoor plant watering",
        description: "Keep the soil moist.",
      }),
      clipCandidate({
        id: "d",
        title: "Baking sourdough bread",
        description: "Starter and oven spring.",
      }),
      clipCandidate({
        id: "e",
        title: "Morning coffee ritual",
        description: "Grind and bloom.",
      }),
    ];

    const result = await applyInspirationToBatch({
      store,
      config,
      clock: { now: () => now },
      logger,
      candidates,
    });

    expect(result.candidates).toHaveLength(5);
    expect(result.shortfall).toBeGreaterThan(0);
    expect(
      warnings.some((entry) => entry.msg === "inspiration_quota_shortfall"),
    ).toBe(true);
  });

  it("replaces existing links on re-apply instead of colliding on PK", async () => {
    const store = new MemoryInspirationStore();
    store.latestOkSyncAt = new Date("2026-08-13T18:00:00.000Z");
    store.ideas = [ideaRecord({ id: "idea-1" })];
    const { logger } = capturingLogger();
    const candidates = [
      clipCandidate({
        id: "c-matched",
        title: "Oschersleben last lap battle",
        description: "Door-to-door fight at Oschersleben",
      }),
    ];
    const input = {
      store,
      config,
      clock: { now: () => now },
      logger,
      candidates,
    };

    await applyInspirationToBatch(input);
    const second = await applyInspirationToBatch(input);

    expect(second.candidates[0]?.id).toBe("c-matched");
    expect(store.links).toHaveLength(1);
    expect(store.links[0]).toEqual(
      expect.objectContaining({
        candidateId: "c-matched",
        ideaId: "idea-1",
      }),
    );
  });

  it("warns and still returns biased candidates when link persistence fails", async () => {
    const store = new MemoryInspirationStore();
    store.latestOkSyncAt = new Date("2026-08-13T18:00:00.000Z");
    store.ideas = [ideaRecord({ id: "idea-1" })];
    store.saveCandidateLinks = async () => {
      throw new Error("link write failed");
    };
    const { logger, warnings } = capturingLogger();
    const matched = clipCandidate({
      id: "c-matched",
      title: "Oschersleben last lap battle",
      description: "Door-to-door fight at Oschersleben",
      score: 0.7,
    });

    const result = await applyInspirationToBatch({
      store,
      config,
      clock: { now: () => now },
      logger,
      candidates: [matched],
    });

    expect(result.stale).toBe(false);
    expect(result.candidates[0]?.score).toBeGreaterThan(0.7);
    expect(result.matchedIdeaIds).toEqual(["idea-1"]);
    expect(
      warnings.some((entry) =>
        entry.msg.includes("Inspiration link persistence failed"),
      ),
    ).toBe(true);
  });

  it("matches generate candidates when matchTextFor includes hook text", async () => {
    const store = new MemoryInspirationStore();
    store.latestOkSyncAt = new Date("2026-08-13T18:00:00.000Z");
    store.ideas = [ideaRecord({ id: "idea-1" })];
    const { logger } = capturingLogger();
    const candidate = generateCandidate({
      id: "c-hook",
      title: "A racing tip",
    });

    const withoutHook = await applyInspirationToBatch({
      store,
      config,
      clock: { now: () => now },
      logger,
      candidates: [candidate],
    });
    expect(withoutHook.candidates[0]?.score).toBe(0.7);
    expect(store.links).toEqual([]);

    const withHook = await applyInspirationToBatch({
      store,
      config,
      clock: { now: () => now },
      logger,
      candidates: [candidate],
      matchTextFor: (item) =>
        [item.title, item.description, "Oschersleben last lap battle door-to-door"]
          .filter(Boolean)
          .join(" "),
    });

    expect(withHook.candidates[0]?.score).toBeGreaterThan(0.7);
    expect(store.links).toEqual([
      expect.objectContaining({
        candidateId: "c-hook",
        ideaId: "idea-1",
      }),
    ]);
  });

  it("applies only selected ideaIds and bypasses stale gate when requested", async () => {
    const store = new MemoryInspirationStore();
    store.latestOkSyncAt = new Date("2026-08-01T18:00:00.000Z");
    store.ideas = [
      ideaRecord({ id: "only-this", title: "Oschersleben battle for P2" }),
      ideaRecord({ id: "other-idea", title: "Monza qualifying pace" }),
    ];
    const { logger, warnings } = capturingLogger();
    const matched = clipCandidate({
      id: "c-matched",
      title: "Oschersleben last lap battle",
      description: "Door-to-door fight at Oschersleben",
      score: 0.7,
    });

    const result = await applyInspirationToBatch({
      store,
      config,
      clock: { now: () => now },
      logger,
      candidates: [matched],
      ideaIds: ["only-this"],
      bypassStaleGate: true,
    });

    expect(result.stale).toBe(false);
    expect(result.candidates[0]?.score).toBeGreaterThan(0.7);
    expect(store.links).toEqual([
      expect.objectContaining({
        candidateId: "c-matched",
        ideaId: "only-this",
      }),
    ]);
    expect(store.links.some((link) => link.ideaId === "other-idea")).toBe(false);
    expect(warnings.some((entry) => entry.msg === "inspiration_stale")).toBe(
      false,
    );
  });

  it("treats a recent partial sync as fresh for hard bias", async () => {
    const store = new MemoryInspirationStore();
    store.latestOkSyncAt = null;
    store.latestSuccessfulSyncAt = new Date("2026-08-13T18:00:00.000Z");
    store.ideas = [ideaRecord({ id: "idea-1" })];
    const { logger, warnings } = capturingLogger();
    const matched = clipCandidate({
      id: "c-matched",
      title: "Oschersleben last lap battle",
      description: "Door-to-door fight at Oschersleben",
      score: 0.7,
    });

    const result = await applyInspirationToBatch({
      store,
      config,
      clock: { now: () => now },
      logger,
      candidates: [matched],
    });

    expect(result.stale).toBe(false);
    expect(result.candidates[0]?.score).toBeGreaterThan(0.7);
    expect(store.links).toHaveLength(1);
    expect(warnings.some((entry) => entry.msg === "inspiration_stale")).toBe(
      false,
    );
  });
});
