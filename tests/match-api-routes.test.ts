import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const jobQueue = vi.hoisted(() => ({
  enqueue: vi.fn(async () => "job-match-1"),
}));

const sourceVideos = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const inspiration = vi.hoisted(() => ({
  listActiveIdeas: vi.fn(),
  getLatestSuccessfulSyncAt: vi.fn(),
}));

const clock = vi.hoisted(() => ({
  now: vi.fn(() => new Date("2026-08-15T12:00:00.000Z")),
}));

const logger = vi.hoisted(() => ({
  child: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("@/src/lib/container", () => ({
  getContainer: () => ({
    jobQueue,
    repositories: { sourceVideos, inspiration },
    clock,
    logger,
  }),
}));

import { POST as previewMatch } from "@/app/api/match/preview/route";
import { POST as runMatch } from "@/app/api/match/run/route";

describe("match API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inspiration.listActiveIdeas.mockResolvedValue([
      {
        id: "idea-1",
        syncRunId: "sync-1",
        externalKey: "ext-1",
        title: "Safety car drama",
        summary: "Yellow flag chaos",
        audienceInterest: "fans",
        channelAlignment: "race craft",
        relatedInterest: { items: ["safety car"] },
        outline: "Hook then replay",
        suggestedTitles: ["Yellow flag"],
        thumbnailNotes: null,
        rawSnippet: null,
        capturedAt: new Date("2026-08-14T12:00:00.000Z"),
        active: true,
      },
    ]);
    inspiration.getLatestSuccessfulSyncAt.mockResolvedValue(
      new Date("2026-08-14T12:00:00.000Z"),
    );
    sourceVideos.getById.mockImplementation(async (id: string) => {
      if (id !== "vid-1") return null;
      return {
        id: "vid-1",
        channelId: "ch-1",
        youtubeVideoId: "yt-1",
        title: "Safety car restart Monza",
        durationSec: 600,
        localMediaPath: null,
        analyticsSnapshot: {
          viewCount: 1000,
          likeCount: 50,
          commentCount: 10,
        },
        publishedAt: null,
        syncedAt: new Date("2026-08-10T12:00:00.000Z"),
      };
    });
  });

  it("returns 400 when run pairs are empty", async () => {
    const response = await runMatch(
      new NextRequest("http://localhost/api/match/run", {
        method: "POST",
        body: JSON.stringify({ channelId: "ch-1", pairs: [] }),
      }),
    );
    expect(response.status).toBe(400);
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it("enqueues match_propose_shorts for valid pairs", async () => {
    const response = await runMatch(
      new NextRequest("http://localhost/api/match/run", {
        method: "POST",
        body: JSON.stringify({
          channelId: "ch-1",
          pairs: [{ sourceVideoId: "vid-1", ideaId: "idea-1" }],
        }),
      }),
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      jobId: "job-match-1",
    });
    expect(jobQueue.enqueue).toHaveBeenCalledWith({
      type: "match_propose_shorts",
      payload: {
        channelId: "ch-1",
        pairs: [{ sourceVideoId: "vid-1", ideaId: "idea-1" }],
      },
    });
  });

  it("returns 400 when preview has empty ideaIds", async () => {
    const response = await previewMatch(
      new NextRequest("http://localhost/api/match/preview", {
        method: "POST",
        body: JSON.stringify({
          sourceVideoIds: ["vid-1"],
          ideaIds: [],
        }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("ranks pairs for preview", async () => {
    const response = await previewMatch(
      new NextRequest("http://localhost/api/match/preview", {
        method: "POST",
        body: JSON.stringify({
          sourceVideoIds: ["vid-1"],
          ideaIds: ["idea-1"],
          k: 5,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pairs).toHaveLength(1);
    expect(body.pairs[0]).toMatchObject({
      sourceVideoId: "vid-1",
      ideaId: "idea-1",
    });
    expect(typeof body.pairs[0].pairScore).toBe("number");
  });
});
