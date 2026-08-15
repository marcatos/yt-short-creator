import { describe, expect, it } from "vitest";

import { createRunClipAnalysis } from "@/src/application/run-clip-analysis";
import type { ShortCandidate, SourceVideo } from "@/src/domain/entities";
import type { InspirationConfig } from "@/src/domain/inspiration-config";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type {
  CandidateInspirationLink,
  InspirationIdeaRecord,
  InspirationStorePort,
  InspirationSyncRun,
} from "@/src/ports/inspiration-store";
import type { Logger } from "@/src/ports/logger";
import type { SourceVideoRepository } from "@/src/ports/source-video-repository";

const now = new Date("2026-08-11T10:00:00.000Z");

class MemorySourceVideoRepository implements SourceVideoRepository {
  constructor(readonly video: SourceVideo) {}

  async save(video: SourceVideo): Promise<void> {
    Object.assign(this.video, video);
  }

  async getById(id: string): Promise<SourceVideo | null> {
    return this.video.id === id ? this.video : null;
  }

  async getByYoutubeVideoId(youtubeVideoId: string): Promise<SourceVideo | null> {
    return this.video.youtubeVideoId === youtubeVideoId ? this.video : null;
  }

  async listByChannelId(channelId: string): Promise<SourceVideo[]> {
    return this.video.channelId === channelId ? [this.video] : [];
  }

  async upsertMany(): Promise<void> {}

  async deleteByIds(): Promise<void> {}
}

class MemoryCandidateRepository implements CandidateRepository {
  readonly items: ShortCandidate[] = [];

  async save(candidate: ShortCandidate): Promise<void> {
    this.items.push(candidate);
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
    getLatestSuccessfulSyncAt: async () => null,
    getLatestFinishedSyncAt: async () => null,
    replaceActiveIdeas: async () => {},
    listActiveIdeas: async () => [],
    deleteLinksForCandidates: async () => {},
    saveCandidateLinks: async () => {},
    listLinksForCandidates: async () => [],
  };
}

const inspirationConfig: InspirationConfig = {
  matchMin: 0.25,
  scoreBoost: 0.12,
  quotaRatio: 0.4,
  staleDays: 7,
  generateFillMax: 3,
};

class MemoryInspirationStore implements InspirationStorePort {
  ideas: InspirationIdeaRecord[] = [];
  latestOkSyncAt: Date | null = null;
  links: CandidateInspirationLink[] = [];

  async saveSyncRun(): Promise<void> {}
  async listSyncRuns(): Promise<InspirationSyncRun[]> {
    return [];
  }
  async getLatestOkSyncAt(): Promise<Date | null> {
    return this.latestOkSyncAt;
  }
  async getLatestSuccessfulSyncAt(): Promise<Date | null> {
    return this.latestOkSyncAt;
  }
  async getLatestFinishedSyncAt(): Promise<Date | null> {
    return this.latestOkSyncAt;
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
    this.links.push(...links);
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

describe("runClipAnalysis", () => {
  it("downloads the source and saves proposed clip candidates with timestamp provenance", async () => {
    const sourceVideos = new MemorySourceVideoRepository({
      id: "source-1",
      channelId: "channel-1",
      youtubeVideoId: "youtube-1",
      title: "Fastest lap breakdown",
      durationSec: 180,
      localMediaPath: null,
      analyticsSnapshot: null,
      publishedAt: now,
      syncedAt: now,
    });
    const candidates = new MemoryCandidateRepository();
    const downloaded: string[] = [];
    const runClipAnalysis = createRunClipAnalysis({
      llm: {
        complete: async () =>
          JSON.stringify({
            windows: [
              {
                startMs: 12_000,
                endMs: 42_000,
                title: "The braking trick that saves a lap",
                description: "A concise breakdown of late braking.",
                tags: ["racing", "braking"],
                score: 0.91,
                hookReason: "The counterintuitive claim creates immediate curiosity.",
              },
            ],
          }),
      },
      videoDownload: {
        download: async (youtubeVideoId) => {
          downloaded.push(youtubeVideoId);
          return "media/youtube-1.mp4";
        },
      },
      sourceVideos,
      candidates,
      id: { generate: () => "candidate-1" },
      clock: { now: () => now },
      logger: createLogger(),
      inspirationStore: emptyInspirationStore(),
    });

    const result = await runClipAnalysis({ sourceVideoId: "source-1" });

    expect(downloaded).toEqual(["youtube-1"]);
    expect(sourceVideos.video.localMediaPath).toBe("media/youtube-1.mp4");
    expect(result).toEqual(candidates.items);
    expect(result).toEqual([
      expect.objectContaining({
        id: "candidate-1",
        origin: "clip",
        status: "proposed",
        title: "The braking trick that saves a lap",
        description:
          "A concise breakdown of late braking.\n\nFull video: https://youtu.be/youtube-1",
        score: 0.91,
        provenance: {
          sourceVideoId: "source-1",
          startMs: 12_000,
          endMs: 42_000,
          hookReason: "The counterintuitive claim creates immediate curiosity.",
          crop: { mode: "center_vertical", focusX: 0.5 },
        },
      }),
    ]);
  });

  it("constrains inspiration prompt and apply to selected ideaIds", async () => {
    const store = new MemoryInspirationStore();
    store.latestOkSyncAt = new Date("2026-08-01T18:00:00.000Z");
    store.ideas = [
      ideaRecord({ id: "idea-1", title: "Oschersleben battle for P2" }),
      ideaRecord({ id: "idea-2", title: "Monza qualifying pace" }),
    ];
    const sourceVideos = new MemorySourceVideoRepository({
      id: "source-1",
      channelId: "channel-1",
      youtubeVideoId: "youtube-1",
      title: "Fastest lap breakdown",
      durationSec: 180,
      localMediaPath: "media/youtube-1.mp4",
      analyticsSnapshot: null,
      publishedAt: now,
      syncedAt: now,
    });
    const candidates = new MemoryCandidateRepository();
    let llmUserPrompt = "";
    const runClipAnalysis = createRunClipAnalysis({
      llm: {
        complete: async ({ user }) => {
          llmUserPrompt = user;
          return JSON.stringify({
            windows: [
              {
                startMs: 12_000,
                endMs: 42_000,
                title: "Oschersleben last lap battle",
                description: "Door-to-door fight at Oschersleben",
                tags: ["racing"],
                score: 0.7,
                hookReason: "Immediate battle tension",
              },
            ],
          });
        },
      },
      videoDownload: {
        download: async () => "media/youtube-1.mp4",
      },
      sourceVideos,
      candidates,
      id: { generate: () => "candidate-1" },
      clock: { now: () => now },
      logger: createLogger(),
      inspirationStore: store,
      inspirationConfig,
    });

    const result = await runClipAnalysis({
      sourceVideoId: "source-1",
      ideaIds: ["idea-1"],
    });

    expect(llmUserPrompt).toContain("Oschersleben battle for P2");
    expect(llmUserPrompt).not.toContain("Monza qualifying pace");
    expect(llmUserPrompt).toContain(
      "Prioritize moments that best serve the Inspiration idea(s) above. Do not invent footage facts.",
    );
    expect(result[0]?.score).toBeGreaterThan(0.7);
    expect(store.links).toEqual([
      expect.objectContaining({
        candidateId: "candidate-1",
        ideaId: "idea-1",
      }),
    ]);
    expect(store.links.some((link) => link.ideaId === "idea-2")).toBe(false);
  });
});
