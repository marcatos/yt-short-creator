import { describe, expect, it } from "vitest";

import {
  buildCommentaryChapterScene,
  PLAY_BY_PLAY_COMMENTARY_RULES,
} from "@/src/domain/commentary-chapter-scene";
import type { CommentaryTimelineChapter } from "@/src/domain/commentary-timeline-segments";
import type { RaceAnalysis } from "@/src/domain/race-analysis";

const chapter: CommentaryTimelineChapter = {
  label: "Race segment 2 (01:30)",
  startMs: 90_000,
  endMs: 180_000,
  summaries: ["Battle for P10"],
  events: [
    {
      kind: "overtake",
      startMs: 100_000,
      endMs: 105_000,
      summary: "Pass on #17 into T1",
      involvingFocusCar: true,
      confidence: "verified",
    },
  ],
  targetWordsMin: 40,
  targetWordsMax: 80,
};

function analysis(overrides: Partial<RaceAnalysis> = {}): RaceAnalysis {
  return {
    version: 1,
    focusCarHint: "#42",
    context: {
      simulator: "iRacing",
      track: "Oschersleben",
      car: "GR86",
      durationSec: 600,
    },
    results: {
      qualiResult: null,
      startPosition: 18,
      finishPosition: 8,
      fieldSize: 24,
      positionsGained: 10,
    },
    recurringRivals: ["#17"],
    events: chapter.events,
    timeline: [
      {
        startMs: 90_000,
        endMs: 180_000,
        summary: "Battle for P10",
        involvingFocusCar: true,
      },
    ],
    storylines: [],
    mainStoryline: "Rimonta",
    whyWatch: "Battaglie",
    potentialHooks: [],
    shortCandidates: [
      {
        shortScore: 0.9,
        startMs: 0,
        endMs: 30_000,
        hook: "h",
        story: "s",
        payoff: "p",
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
    audioTranscriptSegments: [
      { startMs: 95_000, endMs: 98_000, text: "side by side into turn one" },
    ],
    commentaryMarkers: [],
    hudTimeline: [
      {
        timeMs: 100_000,
        session: { sessionType: null, status: "green", trackName: null, lap: 4, sessionTime: null, flag: null },
        focus: {
          carNumber: 42,
          driverName: "Marcato",
          position: 10,
          fieldSize: 24,
          lastLap: null,
          bestLap: null,
          gapToLeader: "+12.4s",
          deltaBest: "-0.3s",
          fuelPct: null,
          sectors: null,
        },
        battle: {
          rows: [
            { role: "ahead", carNumber: 17, driverName: "Rival", gapSec: 0.4 },
            { role: "focus", carNumber: 42, driverName: "Marcato", gapSec: 0 },
            { role: "behind", carNumber: 9, driverName: "Chaser", gapSec: 0.8 },
          ],
        },
        standings: null,
        battleCallout: null,
        fieldTicker: null,
      },
    ],
    ...overrides,
  };
}

describe("commentary-chapter-scene", () => {
  it("exports play-by-play rules mentioning sceneFacts", () => {
    expect(PLAY_BY_PLAY_COMMENTARY_RULES).toContain("sceneFacts");
    expect(PLAY_BY_PLAY_COMMENTARY_RULES).toContain("on screen");
  });

  it("builds rich scene context from hud, events, and transcript", () => {
    const scene = buildCommentaryChapterScene(analysis(), chapter);
    expect(scene.sceneDensity).toBe("moderate");
    expect(scene.events).toHaveLength(1);
    expect(scene.hudSnapshots[0]?.focusPosition).toBe(10);
    expect(scene.transcriptCues[0]).toContain("side by side");
    expect(scene.timelineBeats).toContain("Battle for P10");
  });

  it("marks sparse windows when little data exists", () => {
    const scene = buildCommentaryChapterScene(
      analysis({
        events: [],
        timeline: [],
        hudTimeline: [],
        audioTranscriptSegments: [],
      }),
      { ...chapter, summaries: ["Race segment 2/12"] },
    );
    expect(scene.sceneDensity).toBe("sparse");
  });
});
