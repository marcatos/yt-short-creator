import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const container = vi.hoisted(() => ({
  repositories: {
    inspiration: {
      listActiveIdeas: vi.fn(),
      listSyncRuns: vi.fn(),
      getLatestSuccessfulSyncAt: vi.fn(),
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/src/lib/container", () => ({
  getContainer: () => container,
}));

import { CandidateQueue } from "@/app/components/CandidateQueue";
import { InspirationSyncButton } from "@/app/components/InspirationSyncButton";
import { ReviewPanel } from "@/app/components/ReviewPanel";
import InspirationPage from "@/app/inspiration/page";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function render(node: React.ReactElement): string {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  return renderToStaticMarkup(node);
}

describe("inspiration UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a Sync now control", () => {
    const markup = render(createElement(InspirationSyncButton));
    expect(markup).toContain("Sync now");
  });

  it("lists active ideas, expandable details, sync history, and a stale badge", async () => {
    container.repositories.inspiration.listActiveIdeas.mockResolvedValue([
      {
        id: "idea-1",
        syncRunId: "run-1",
        externalKey: "key-1",
        title: "Wet qualifying drama",
        summary: "Rain changes the grid.",
        audienceInterest: "Sim racing fans",
        channelAlignment: "On-brand race craft",
        relatedInterest: { items: ["Safety car"], raw: "Safety car" },
        outline: "Open on spray, cut to the call.",
        suggestedTitles: ["Rain shuffle"],
        thumbnailNotes: "Red flag lights in frame",
        rawSnippet: null,
        capturedAt: new Date("2026-08-01T10:00:00.000Z"),
        active: true,
      },
    ]);
    container.repositories.inspiration.listSyncRuns.mockResolvedValue([
      {
        id: "run-1",
        startedAt: new Date("2026-08-01T10:00:00.000Z"),
        finishedAt: new Date("2026-08-01T10:01:00.000Z"),
        status: "ok",
        ideaCount: 1,
        errorMessage: null,
        source: "manual",
      },
    ]);
    container.repositories.inspiration.getLatestSuccessfulSyncAt.mockResolvedValue(
      new Date(Date.now() - 10 * MS_PER_DAY),
    );

    const markup = render(await InspirationPage());

    expect(markup).toContain("Wet qualifying drama");
    expect(markup).toContain("Rain changes the grid.");
    expect(markup).toContain("Sim racing fans");
    expect(markup).toContain("On-brand race craft");
    expect(markup).toContain("Rain shuffle");
    expect(markup).toContain("Open on spray, cut to the call.");
    expect(markup).toContain("Safety car");
    expect(markup).toContain("Red flag lights in frame");
    expect(markup).toContain("Sync now");
    expect(markup).toContain("Stale");
    expect(markup).toContain("manual");
    expect(markup).toContain(">ok<");
  });

  it("omits the stale badge when the latest successful sync is fresh", async () => {
    container.repositories.inspiration.listActiveIdeas.mockResolvedValue([]);
    container.repositories.inspiration.listSyncRuns.mockResolvedValue([]);
    container.repositories.inspiration.getLatestSuccessfulSyncAt.mockResolvedValue(
      new Date(),
    );

    const markup = render(await InspirationPage());

    expect(markup).not.toContain("Stale");
    expect(markup).toContain("Sync now");
  });

  it("shows an Inspiration chip with idea titles on aligned candidates", () => {
    const markup = render(
      createElement(CandidateQueue, {
        candidates: [
          {
            id: "cand-1",
            origin: "clip",
            status: "proposed",
            title: "Late pass",
            score: 0.9,
            sourceHint: "Source video",
            createdAt: "2026-08-14T10:00:00.000Z",
            endedAt: null,
            previewUrl: "/api/candidates/cand-1/media",
            inspirationTitles: ["Wet qualifying drama"],
          },
        ],
      }),
    );

    expect(markup).toContain("Inspiration");
    expect(markup).toContain("Wet qualifying drama");
  });

  it("links the review Inspiration chip to /inspiration", () => {
    const markup = render(
      createElement(ReviewPanel, {
        candidate: {
          id: "cand-1",
          origin: "replay",
          status: "proposed",
          title: "Late pass",
          description: "A decisive move.",
          tags: ["simracing"],
          score: 0.9,
          scheduledAt: null,
          renderOutputPath: null,
          provenance: {
            replaySessionId: "session-1",
            startMs: 1_000,
            endMs: 10_000,
          },
          voiceOvers: [],
          inspirationTitles: ["Wet qualifying drama"],
        },
      }),
    );

    expect(markup).toContain("Inspiration");
    expect(markup).toContain('href="/inspiration"');
    expect(markup).toContain("Wet qualifying drama");
  });
});
