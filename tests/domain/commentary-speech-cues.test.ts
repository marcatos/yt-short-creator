import { describe, expect, it } from "vitest";

import {
  buildCommentarySpeechCues,
  shouldUseCuedCommentaryScripts,
  thinSpeechCues,
} from "@/src/domain/commentary-speech-cues";
import type { RaceAnalysis } from "@/src/domain/race-analysis";

function analysis(overrides: Partial<RaceAnalysis> = {}): RaceAnalysis {
  return {
    version: 1,
    focusCarHint: "#42",
    context: {
      simulator: "iRacing",
      track: "Oschersleben",
      car: "GR86",
      durationSec: 900,
    },
    results: {
      qualiResult: null,
      startPosition: 18,
      finishPosition: 8,
      fieldSize: 24,
      positionsGained: 10,
    },
    recurringRivals: [],
    events: [
      {
        kind: "overtake",
        startMs: 120_000,
        endMs: 125_000,
        summary: "Pass into T1",
        involvingFocusCar: true,
        confidence: "verified",
      },
      {
        kind: "battle",
        startMs: 300_000,
        endMs: 330_000,
        summary: "Side by side through the chicane",
        involvingFocusCar: true,
        confidence: "inferred",
      },
    ],
    timeline: [
      {
        startMs: 0,
        endMs: 60_000,
        summary: "Launch off the line",
        involvingFocusCar: true,
      },
      {
        startMs: 500_000,
        endMs: 540_000,
        summary: "Attack on the main straight",
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
    audioTranscriptSegments: [],
    commentaryMarkers: [
      {
        kind: "race_start",
        timeMs: 2_000,
        rawText: "Green flag",
        source: "heuristic",
      },
    ],
    hudTimeline: [],
    ...overrides,
  };
}

describe("commentary-speech-cues", () => {
  it("builds sorted cues from events, timeline, and markers", () => {
    const cues = buildCommentarySpeechCues(analysis());
    expect(cues.length).toBeGreaterThanOrEqual(4);
    expect(cues[0]!.targetMs).toBeLessThanOrEqual(cues[1]!.targetMs);
    expect(cues.some((cue) => cue.kind === "overtake")).toBe(true);
  });

  it("anticipates overtakes slightly before the event", () => {
    const cues = buildCommentarySpeechCues(analysis());
    const overtake = cues.find((cue) => cue.kind === "overtake");
    expect(overtake?.targetMs).toBe(120_000 - 1_200);
  });

  it("enables cued commentary for commentator mode with enough cues", () => {
    expect(shouldUseCuedCommentaryScripts(analysis(), "commentator")).toBe(true);
    expect(shouldUseCuedCommentaryScripts(analysis(), "driver")).toBe(false);
  });

  it("thins cues that are too close in time", () => {
    const dense = thinSpeechCues([
      {
        cueId: "a",
        targetMs: 10_000,
        endMs: null,
        kind: "timeline",
        label: "a",
        summary: "a",
        involvingFocusCar: true,
        targetWordsMin: 5,
        targetWordsMax: 20,
      },
      {
        cueId: "b",
        targetMs: 12_000,
        endMs: null,
        kind: "other",
        label: "b",
        summary: "b",
        involvingFocusCar: false,
        targetWordsMin: 5,
        targetWordsMax: 20,
      },
    ]);
    expect(dense).toHaveLength(1);
    expect(dense[0]!.cueId).toBe("a");
  });
});
