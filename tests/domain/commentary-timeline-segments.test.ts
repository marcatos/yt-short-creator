import { describe, expect, it } from "vitest";

import {
  buildCommentaryChaptersFromTimeline,
  shouldUseTimelineChapteredScripts,
} from "@/src/domain/commentary-timeline-segments";
import type { RaceAnalysis } from "@/src/domain/race-analysis";

function analysis(overrides: Partial<RaceAnalysis> = {}): RaceAnalysis {
  return {
    version: 1,
    focusCarHint: "pi",
    context: {
      simulator: "iRacing",
      track: "Oschersleben",
      car: "GR86",
      durationSec: 932,
    },
    results: {
      qualiResult: null,
      startPosition: 18,
      finishPosition: 8,
      fieldSize: 24,
      positionsGained: 10,
    },
    recurringRivals: [],
    events: [],
    timeline: [
      {
        startMs: 0,
        endMs: 120_000,
        summary: "Start chaos",
        involvingFocusCar: true,
      },
      {
        startMs: 300_000,
        endMs: 420_000,
        summary: "Mid-race battle",
        involvingFocusCar: true,
      },
      {
        startMs: 780_000,
        endMs: 900_000,
        summary: "Final overtake",
        involvingFocusCar: true,
      },
    ],
    storylines: [],
    mainStoryline: "Rimonta",
    whyWatch: "Battaglie",
    potentialHooks: ["P18 to P8"],
    shortCandidates: [
      {
        shortScore: 0.9,
        startMs: 0,
        endMs: 30_000,
        hook: "hook",
        story: "story",
        payoff: "payoff",
        recommendedTitleIt: "t",
        recommendedTitleEn: "t",
        requiresLocalizedRender: false,
        tags: [],
        descriptionIt: "d",
        descriptionEn: "d",
      },
    ],
    narrativeIt: "n",
    audioTranscript: "",
    audioSource: "muxed",
    audioTranscriptSegments: [],
    commentaryMarkers: [],
    hudTimeline: [],
    ...overrides,
  };
}

describe("commentary-timeline-segments", () => {
  it("enables chaptered scripts for long commentator races", () => {
    expect(
      shouldUseTimelineChapteredScripts(analysis(), "commentator"),
    ).toBe(true);
    expect(shouldUseTimelineChapteredScripts(analysis(), "driver")).toBe(true);
  });

  it("builds multiple chapters with word targets from timeline", () => {
    const chapters = buildCommentaryChaptersFromTimeline(analysis());
    expect(chapters.length).toBeGreaterThanOrEqual(4);
    expect(chapters[0]!.startMs).toBe(0);
    expect(chapters.at(-1)!.endMs).toBeLessThanOrEqual(932_000);
    expect(chapters[0]!.targetWordsMin).toBeGreaterThan(20);
    expect(chapters[0]!.targetWordsMax).toBeGreaterThan(
      chapters[0]!.targetWordsMin,
    );
  });

  it("splits evenly when timeline is empty", () => {
    const chapters = buildCommentaryChaptersFromTimeline(
      analysis({ timeline: [] }),
    );
    expect(chapters.length).toBeGreaterThanOrEqual(4);
    expect(chapters[0]!.startMs).toBe(0);
  });
});
