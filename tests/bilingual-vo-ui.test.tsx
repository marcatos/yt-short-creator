import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const container = vi.hoisted(() => ({
  generateShortVoiceOvers: vi.fn(),
  approveCandidate: vi.fn(),
  rejectCandidate: vi.fn(),
  requestRevision: vi.fn(),
  repositories: {
    replaySessions: {
      list: vi.fn(),
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/src/lib/container", () => ({
  getContainer: () => container,
}));

import { ReviewPanel } from "@/app/components/ReviewPanel";
import { POST as candidateAction } from "@/app/api/candidates/[id]/[action]/route";
import ReplaysPage from "@/app/replays/page";

describe("bilingual voice-over candidate UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows generation control and per-language package status", () => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    const markup = renderToStaticMarkup(
      createElement(ReviewPanel, {
        candidate: {
          id: "candidate-42",
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
          voiceOvers: [
            {
              language: "it",
              hasAudio: true,
              hasCaptions: true,
              hasRender: false,
              isPublished: false,
            },
            {
              language: "en",
              hasAudio: true,
              hasCaptions: true,
              hasRender: true,
              isPublished: false,
            },
          ],
        },
      }),
    );

    expect(markup).toContain("Generate VO IT+EN");
    expect(markup).toContain("IT");
    expect(markup).toContain("package ready");
    expect(markup).toContain("render ready");
    expect(markup).toContain("Approve remains required");
  });

  it("maps the voice-over action to bilingual package generation", async () => {
    container.generateShortVoiceOvers.mockResolvedValue([
      { language: "it" },
      { language: "en" },
    ]);

    const response = await candidateAction(
      new NextRequest("http://localhost", { method: "POST" }),
      {
        params: Promise.resolve({
          id: "candidate-42",
          action: "voice-over",
        }),
      },
    );

    expect(container.generateShortVoiceOvers).toHaveBeenCalledWith({
      candidateId: "candidate-42",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      voiceOvers: [{ language: "it" }, { language: "en" }],
    });
  });

  it("submits the full replay VO control with voiceOver=true", async () => {
    container.repositories.replaySessions.list.mockResolvedValue([
      {
        id: "session-1",
        title: "Oschersleben",
        trackName: "Oschersleben",
        status: "ready",
        durationSec: 600,
        rpyPath: null,
        mediaPath: "C:/Videos/race.mkv",
        ibtPath: null,
        events: [],
        racePackage: {
          fullVideo: {
            title: "Race",
            description: "Full race",
            tags: ["simracing"],
          },
          timeline: [],
          transcript: "",
        },
        fullVideoYoutubeId: null,
        fullVideoPrivacy: null,
        fullVideoEncodePath: null,
        createdAt: new Date("2026-08-12T10:00:00.000Z"),
      },
    ]);

    const markup = renderToStaticMarkup(await ReplaysPage());

    expect(markup).toContain("Encode + publish multi-lang VO");
    expect(markup).toContain('name="voiceOver"');
    expect(markup).toContain('value="true"');
  });
});
