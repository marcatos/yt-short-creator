import { describe, expect, it } from "vitest";

import { createRunIdeation } from "@/src/application/run-ideation";
import type {
  GenerationBrief,
  ShortCandidate,
} from "@/src/domain/entities";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { GenerationBriefRepository } from "@/src/ports/generation-brief-repository";
import type { InspirationStorePort } from "@/src/ports/inspiration-store";
import type { Logger } from "@/src/ports/logger";

const now = new Date("2026-08-11T10:00:00.000Z");

class MemoryBriefRepository implements GenerationBriefRepository {
  readonly items: GenerationBrief[] = [];

  async save(brief: GenerationBrief): Promise<void> {
    this.items.push(brief);
  }

  async getById(id: string): Promise<GenerationBrief | null> {
    return this.items.find((brief) => brief.id === id) ?? null;
  }

  async listByChannelId(channelId: string): Promise<GenerationBrief[]> {
    return this.items.filter((brief) => brief.channelId === channelId);
  }
}

class MemoryCandidateRepository implements CandidateRepository {
  readonly items: ShortCandidate[] = [];

  async save(candidate: ShortCandidate): Promise<void> {
    const index = this.items.findIndex((item) => item.id === candidate.id);
    if (index === -1) this.items.push(candidate);
    else this.items[index] = candidate;
  }

  async getById(id: string): Promise<ShortCandidate | null> {
    return this.items.find((candidate) => candidate.id === id) ?? null;
  }

  async listByIds(ids: string[]): Promise<ShortCandidate[]> {
    return this.items.filter((candidate) => ids.includes(candidate.id));
  }

  async list(): Promise<ShortCandidate[]> {
    return this.items;
  }
}

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

function emptyInspirationStore(): InspirationStorePort {
  return {
    saveSyncRun: async () => {},
    listSyncRuns: async () => [],
    getLatestOkSyncAt: async () => null,
    replaceActiveIdeas: async () => {},
    listActiveIdeas: async () => [],
    deleteLinksForCandidates: async () => {},
    saveCandidateLinks: async () => {},
    listLinksForCandidates: async () => [],
  };
}

describe("runIdeation", () => {
  it("saves generated briefs and candidates with TTS and round-robin B-roll", async () => {
    const briefs = new MemoryBriefRepository();
    const candidates = new MemoryCandidateRepository();
    const synthesized: string[] = [];
    const ids = ["brief-1", "candidate-1", "brief-2", "candidate-2"];
    const runIdeation = createRunIdeation({
      llm: {
        complete: async () =>
          JSON.stringify({
            ideas: [
              {
                hook: "La frenata che cambia tutto",
                script: "Prima frena dritto, poi rilascia gradualmente.",
                title: "La frenata perfetta",
                description: "Una tecnica semplice per essere più veloci.",
                tags: ["racing", "frenata"],
                score: 0.92,
                voiceProfile: "alloy",
                brollPlan: ["Staccata", "Ingresso curva"],
              },
              {
                hook: "Guarda dove perdi velocità",
                script: "La telemetria rivela il punto esatto.",
                title: "Leggi la telemetria",
                description: "Trova tempo sul giro con i dati.",
                tags: ["telemetria"],
                score: 0.84,
                voiceProfile: "alloy",
                brollPlan: ["Dashboard"],
              },
            ],
          }),
      },
      tts: {
        synthesize: async ({ outputPath }) => {
          synthesized.push(outputPath);
          return { durationMs: 6_000 };
        },
      },
      mediaStore: {
        sourcePath: () => "",
        renderPath: () => "",
        audioPath: (id) => `media/audio/${id}.mp3`,
        brollPath: (filename) => `media/broll/${filename}`,
        listBroll: async () => ["corner.mp4", "dash.mp4"],
        ensureDirs: async () => {},
      },
      briefs,
      candidates,
      id: { generate: () => ids.shift() ?? "unexpected-id" },
      clock: { now: () => now },
      logger: createLogger(),
      inspirationStore: emptyInspirationStore(),
    });

    const result = await runIdeation({ channelId: "channel-1", count: 2 });

    expect(briefs.items).toHaveLength(2);
    expect(synthesized).toEqual([
      "media/audio/candidate-1.mp3",
      "media/audio/candidate-2.mp3",
    ]);
    expect(result).toEqual(candidates.items);
    expect(result[0]).toMatchObject({
      id: "candidate-1",
      origin: "generate",
      status: "proposed",
      title: "La frenata perfetta",
      provenance: {
        generationBriefId: "brief-1",
        scriptVersion: 1,
        voiceAssetPath: "media/audio/candidate-1.mp3",
        timeline: [
          { asset: "media/broll/corner.mp4", startMs: 0, endMs: 3_000 },
          { asset: "media/broll/dash.mp4", startMs: 3_000, endMs: 6_000 },
        ],
      },
    });
    expect(result[1].provenance).toMatchObject({
      timeline: [
        { asset: "media/broll/corner.mp4", startMs: 0, endMs: 6_000 },
      ],
    });
  });

  it("still saves a script-only candidate when B-roll is empty", async () => {
    const briefs = new MemoryBriefRepository();
    const candidates = new MemoryCandidateRepository();
    const ids = ["brief-1", "candidate-1"];
    const runIdeation = createRunIdeation({
      llm: {
        complete: async () =>
          JSON.stringify({
            ideas: [
              {
                hook: "Hook",
                script: "Script",
                title: "Title",
                description: "Description",
                tags: [],
                score: 0.7,
                voiceProfile: "alloy",
                brollPlan: ["Missing footage"],
              },
            ],
          }),
      },
      tts: { synthesize: async () => ({ durationMs: 4_000 }) },
      mediaStore: {
        sourcePath: () => "",
        renderPath: () => "",
        audioPath: (id) => `media/audio/${id}.mp3`,
        brollPath: (filename) => `media/broll/${filename}`,
        listBroll: async () => [],
        ensureDirs: async () => {},
      },
      briefs,
      candidates,
      id: { generate: () => ids.shift() ?? "unexpected-id" },
      clock: { now: () => now },
      logger: createLogger(),
      inspirationStore: emptyInspirationStore(),
    });

    const [candidate] = await runIdeation({ channelId: "channel-1", count: 1 });

    expect(candidate.provenance).toMatchObject({ timeline: [] });
    expect(candidate.description).toBe("Description");
  });

  it("calls generate fill when fresh inspiration quota is short", async () => {
    const briefs = new MemoryBriefRepository();
    const candidates = new MemoryCandidateRepository();
    const ids = ["brief-1", "candidate-1", "brief-2", "candidate-2"];
    const llmUsers: string[] = [];
    const store: InspirationStorePort = {
      ...emptyInspirationStore(),
      getLatestOkSyncAt: async () => new Date("2026-08-13T18:00:00.000Z"),
      listActiveIdeas: async () => [
        {
          id: "idea-1",
          syncRunId: "run-1",
          externalKey: "ext-1",
          title: "Oschersleben battle for P2",
          summary: "Door-to-door last laps at Oschersleben",
          audienceInterest: null,
          channelAlignment: null,
          relatedInterest: null,
          outline: null,
          suggestedTitles: ["Last lap fight at Oschersleben"],
          thumbnailNotes: null,
          rawSnippet: null,
          capturedAt: now,
          active: true,
        },
      ],
      deleteLinksForCandidates: async () => {},
      saveCandidateLinks: async () => {},
    };
    const pastaIdea = {
      hook: "Carbonara in due minuti",
      script: "Uova, pecorino, pepe.",
      title: "How to cook pasta carbonara",
      description: "A kitchen tutorial with eggs and pecorino.",
      tags: ["cooking"],
      score: 0.7,
      voiceProfile: "alloy",
      brollPlan: ["Kitchen"],
    };
    const fillIdea = {
      hook: "Battaglia all'ultimo giro",
      script: "Porta a porta a Oschersleben.",
      title: "Oschersleben last lap battle",
      description: "Door-to-door fight at Oschersleben",
      tags: ["racing"],
      score: 0.88,
      voiceProfile: "alloy",
      brollPlan: ["Onboard"],
    };
    const runIdeation = createRunIdeation({
      llm: {
        complete: async (input) => {
          llmUsers.push(input.user);
          const ideas = llmUsers.length === 1 ? [pastaIdea] : [fillIdea];
          return JSON.stringify({ ideas });
        },
      },
      tts: { synthesize: async () => ({ durationMs: 4_000 }) },
      mediaStore: {
        sourcePath: () => "",
        renderPath: () => "",
        audioPath: (id) => `media/audio/${id}.mp3`,
        brollPath: (filename) => `media/broll/${filename}`,
        listBroll: async () => [],
        ensureDirs: async () => {},
      },
      briefs,
      candidates,
      id: { generate: () => ids.shift() ?? "unexpected-id" },
      clock: { now: () => now },
      logger: createLogger(),
      inspirationStore: store,
      inspirationConfig: {
        matchMin: 0.25,
        scoreBoost: 0.12,
        quotaRatio: 0.4,
        staleDays: 7,
        generateFillMax: 3,
      },
    });

    const result = await runIdeation({ channelId: "channel-1", count: 1 });

    expect(llmUsers).toHaveLength(2);
    expect(llmUsers[1]).toContain("Oschersleben battle for P2");
    expect(result).toHaveLength(2);
    expect(result[1]?.title).toBe("Oschersleben last lap battle");
  });
});
