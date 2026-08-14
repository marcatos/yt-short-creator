import { describe, expect, it } from "vitest";

import { createSyncInspiration } from "@/src/application/sync-inspiration";
import type {
  CandidateInspirationLink,
  InspirationIdeaRecord,
  InspirationStorePort,
  InspirationSyncRun,
} from "@/src/ports/inspiration-store";
import type { Logger } from "@/src/ports/logger";
import type {
  CapturedInspirationIdea,
  InspirationCaptureResult,
  YouTubeStudioInspirationPort,
} from "@/src/ports/youtube-studio-inspiration";
import { StudioSessionUnavailableError } from "@/src/ports/youtube-studio-inspiration";

const now = new Date("2026-08-14T18:00:00.000Z");

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

function captured(
  overrides: Partial<CapturedInspirationIdea> &
    Pick<CapturedInspirationIdea, "externalKey" | "title">,
): CapturedInspirationIdea {
  return {
    summary: "Studio summary",
    audienceInterest: "sim racing",
    channelAlignment: "high",
    relatedInterest: { videos: ["abc"] },
    outline: "Hook, mistake, fix.",
    suggestedTitles: ["Brake later"],
    thumbnailNotes: "helmet cam",
    rawSnippet: "card html",
    ...overrides,
  };
}

class MemoryInspirationStore implements InspirationStorePort {
  readonly runs = new Map<string, InspirationSyncRun>();
  readonly ideas: InspirationIdeaRecord[] = [];
  readonly links: CandidateInspirationLink[] = [];

  async saveSyncRun(run: InspirationSyncRun): Promise<void> {
    this.runs.set(run.id, { ...run });
  }

  async listSyncRuns(limit: number): Promise<InspirationSyncRun[]> {
    return [...this.runs.values()]
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, Math.max(0, limit));
  }

  async getLatestOkSyncAt(): Promise<Date | null> {
    return this.latestSyncAt("ok");
  }

  async getLatestSuccessfulSyncAt(): Promise<Date | null> {
    return this.latestSyncAt("ok", "partial");
  }

  async getLatestFinishedSyncAt(): Promise<Date | null> {
    return this.latestSyncAt("ok", "partial", "failed");
  }

  private latestSyncAt(
    ...statuses: Array<"ok" | "partial" | "failed">
  ): Date | null {
    const wanted = new Set(statuses);
    const match = [...this.runs.values()]
      .filter((run) => wanted.has(run.status))
      .sort(
        (a, b) =>
          (b.finishedAt ?? b.startedAt).getTime() -
          (a.finishedAt ?? a.startedAt).getTime(),
      )[0];
    return match ? (match.finishedAt ?? match.startedAt) : null;
  }

  async replaceActiveIdeas(
    syncRunId: string,
    incoming: InspirationIdeaRecord[],
  ): Promise<void> {
    for (const idea of this.ideas) {
      idea.active = false;
    }
    const existingIds = new Set(this.ideas.map((idea) => idea.id));
    for (const idea of incoming) {
      if (existingIds.has(idea.id)) {
        throw new Error(`inspiration idea PK collision: ${idea.id}`);
      }
      this.ideas.push({ ...idea, syncRunId, active: true });
    }
  }

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

function fakeStudio(
  result: InspirationCaptureResult | (() => Promise<InspirationCaptureResult>),
): YouTubeStudioInspirationPort {
  return {
    sync:
      typeof result === "function"
        ? result
        : async () => result,
  };
}

describe("syncInspiration", () => {
  it("replaces the active idea set with two captured ideas and deactivates the previous snapshot", async () => {
    const store = new MemoryInspirationStore();
    await store.saveSyncRun({
      id: "run-old",
      startedAt: new Date("2026-08-13T18:00:00.000Z"),
      finishedAt: new Date("2026-08-13T18:01:00.000Z"),
      status: "ok",
      ideaCount: 1,
      errorMessage: null,
      source: "scheduled",
    });
    await store.replaceActiveIdeas("run-old", [
      {
        id: "old-idea-1",
        syncRunId: "run-old",
        externalKey: "studio:old",
        title: "Old idea",
        summary: "Previous snapshot",
        audienceInterest: null,
        channelAlignment: null,
        relatedInterest: null,
        outline: null,
        suggestedTitles: [],
        thumbnailNotes: null,
        rawSnippet: null,
        capturedAt: new Date("2026-08-13T18:01:00.000Z"),
        active: true,
      },
    ]);

    let nextId = 0;
    const syncInspiration = createSyncInspiration({
      studio: fakeStudio({
        status: "ok",
        ideas: [
          captured({ externalKey: "studio:a", title: "Trail brake T1" }),
          captured({
            externalKey: "studio:b",
            title: "Wet race guide",
            audienceInterest: null,
            channelAlignment: null,
            relatedInterest: null,
            outline: null,
            suggestedTitles: [],
            thumbnailNotes: null,
            rawSnippet: null,
          }),
        ],
      }),
      store,
      id: { generate: () => `id-${++nextId}` },
      clock: { now: () => now },
      logger: createLogger(),
    });

    const summary = await syncInspiration.run({ source: "manual" });

    const active = await store.listActiveIdeas();
    expect(summary).toEqual({
      id: "id-1",
      status: "ok",
      ideaCount: 2,
      source: "manual",
      errorMessage: null,
    });
    expect(active).toHaveLength(2);
    expect(active.every((idea) => idea.active)).toBe(true);
    expect(active.map((idea) => idea.id).sort()).toEqual(["id-2", "id-3"]);
    expect(active.map((idea) => idea.externalKey).sort()).toEqual([
      "studio:a",
      "studio:b",
    ]);
    expect(store.ideas.find((idea) => idea.id === "old-idea-1")?.active).toBe(
      false,
    );
    expect(active.find((idea) => idea.externalKey === "studio:b")).toMatchObject(
      {
        audienceInterest: null,
        channelAlignment: null,
        relatedInterest: null,
        outline: null,
        thumbnailNotes: null,
        rawSnippet: null,
        suggestedTitles: [],
        syncRunId: "id-1",
        capturedAt: now,
      },
    );
  });

  it("assigns fresh idea ids so a second sync of the same Studio keys does not collide", async () => {
    const store = new MemoryInspirationStore();
    const ideas = [
      captured({ externalKey: "studio:same", title: "Same card" }),
    ];
    let nextId = 0;
    const syncInspiration = createSyncInspiration({
      studio: fakeStudio({ status: "ok", ideas }),
      store,
      id: { generate: () => `id-${++nextId}` },
      clock: { now: () => now },
      logger: createLogger(),
    });

    await syncInspiration.run({ source: "manual" });
    const second = await syncInspiration.run({ source: "scheduled" });

    const active = await store.listActiveIdeas();
    expect(second.status).toBe("ok");
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe("id-4");
    expect(active[0]?.externalKey).toBe("studio:same");
    expect(store.ideas.map((idea) => idea.id)).toEqual(["id-2", "id-4"]);
  });

  it("persists a partial capture and still replaces the active set", async () => {
    const store = new MemoryInspirationStore();
    const syncInspiration = createSyncInspiration({
      studio: fakeStudio({
        status: "partial",
        ideas: [captured({ externalKey: "studio:a", title: "One card" })],
      }),
      store,
      id: { generate: () => "run-partial" },
      clock: { now: () => now },
      logger: createLogger(),
    });

    const summary = await syncInspiration.run({ source: "scheduled" });

    expect(summary.status).toBe("partial");
    expect(summary.ideaCount).toBe(1);
    expect(await store.listActiveIdeas()).toHaveLength(1);
    expect((await store.listSyncRuns(1))[0]?.status).toBe("partial");
  });

  it("finishes the run as failed, keeps previous ideas, and rethrows", async () => {
    const store = new MemoryInspirationStore();
    await store.saveSyncRun({
      id: "run-old",
      startedAt: now,
      finishedAt: now,
      status: "ok",
      ideaCount: 1,
      errorMessage: null,
      source: "manual",
    });
    await store.replaceActiveIdeas("run-old", [
      {
        id: "keep-me",
        syncRunId: "run-old",
        externalKey: "studio:keep",
        title: "Keep",
        summary: "Still valid",
        audienceInterest: null,
        channelAlignment: null,
        relatedInterest: null,
        outline: null,
        suggestedTitles: [],
        thumbnailNotes: null,
        rawSnippet: null,
        capturedAt: now,
        active: true,
      },
    ]);

    const syncInspiration = createSyncInspiration({
      studio: fakeStudio(async () => {
        throw new StudioSessionUnavailableError();
      }),
      store,
      id: { generate: () => "run-failed" },
      clock: { now: () => now },
      logger: createLogger(),
    });

    await expect(syncInspiration.run({ source: "manual" })).rejects.toBeInstanceOf(
      StudioSessionUnavailableError,
    );

    expect(await store.listActiveIdeas()).toEqual([
      expect.objectContaining({ id: "keep-me", active: true }),
    ]);
    expect(store.runs.get("run-failed")).toEqual({
      id: "run-failed",
      startedAt: now,
      finishedAt: now,
      status: "failed",
      ideaCount: 0,
      errorMessage: "YouTube Studio session is unavailable; run npm run studio:login",
      source: "manual",
    });
  });
});
