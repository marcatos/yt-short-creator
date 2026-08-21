import { describe, expect, it } from "vitest";

import {
  computePositionsGained,
  raceAnalysisSchema,
  raceAnalysisToRacePackage,
  type RaceAnalysis,
} from "@/src/domain/race-analysis";

function oscherslebenFixture(): RaceAnalysis {
  return {
    version: 1,
    focusCarHint: "White/black/green π GR86",
    context: {
      simulator: "iRacing",
      track: "Oschersleben",
      car: "Toyota GR86",
      durationSec: 900,
    },
    results: {
      qualiResult: "both laps invalid",
      startPosition: 18,
      finishPosition: 8,
      fieldSize: 20,
      positionsGained: 10,
    },
    recurringRivals: [],
    events: [
      {
        kind: "overtake",
        startMs: 120_000,
        endMs: 145_000,
        summary: "Switchback at the chicane after they cover the inside",
        involvingFocusCar: true,
        confidence: "verified",
      },
    ],
    timeline: [
      {
        startMs: 0,
        endMs: 60_000,
        summary: "Start P18 after bad quali",
        involvingFocusCar: true,
      },
    ],
    storylines: [
      {
        kind: "main",
        summary: "Qualifying disaster → P18 → comeback to P8",
        whyWatch: "Starts P18 and finishes P8 in 15 minutes",
      },
    ],
    mainStoryline: "Qualifica sbagliata → P18 → rimonta → P8",
    whyWatch: "Parte P18 e arriva P8 in 15 minuti",
    potentialHooks: ["P18 → P8", "Qualifica disastrosa"],
    shortCandidates: [
      {
        shortScore: 0.92,
        startMs: 120_000,
        endMs: 155_000,
        hook: "They keep covering the inside",
        story: "I stay outside and set up the second apex",
        payoff: "Pass completed at the chicane",
        recommendedTitleIt: "Difendevano l'interno. Io li passavo dall'altra parte.",
        recommendedTitleEn: "They covered the inside. I took the switchback.",
        requiresLocalizedRender: false,
        tags: ["iRacing", "GR86"],
        descriptionIt: "Sorpasso in chicane",
        descriptionEn: "Chicane overtake",
      },
    ],
    narrativeIt:
      "Sbaglio entrambi i giri di qualifica e parto P18 su 20. In 15 minuti rimonto fino alla P8.",
    audioTranscript: "",
    audioSource: "muxed" as const,
    audioTranscriptSegments: [],
    commentaryMarkers: [],
    hudTimeline: [],
  };
}

describe("race-analysis", () => {
  it("accepts the Oschersleben verified fixture", () => {
    const parsed = raceAnalysisSchema.parse(oscherslebenFixture());
    expect(parsed.results.positionsGained).toBe(10);
    expect(parsed.shortCandidates[0]?.requiresLocalizedRender).toBe(false);
  });

  it("rejects inventing a required non-null string as empty", () => {
    const bad = {
      ...oscherslebenFixture(),
      mainStoryline: "   ",
    };
    expect(raceAnalysisSchema.safeParse(bad).success).toBe(false);
  });

  it("allows null positions when unverified", () => {
    const analysis = oscherslebenFixture();
    analysis.results.startPosition = null;
    analysis.results.finishPosition = null;
    analysis.results.positionsGained = null;
    expect(raceAnalysisSchema.parse(analysis).results.startPosition).toBeNull();
  });

  it("computes positions gained as start minus finish", () => {
    expect(computePositionsGained(18, 8)).toBe(10);
    expect(computePositionsGained(null, 8)).toBeNull();
  });

  it("bridges to legacy RacePackage", () => {
    const pkg = raceAnalysisToRacePackage(oscherslebenFixture());
    expect(pkg.transcript).toContain("P18");
    expect(pkg.timeline).toHaveLength(1);
  });
});
