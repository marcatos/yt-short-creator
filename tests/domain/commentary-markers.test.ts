import { describe, expect, it } from "vitest";

import {
  applyCommentaryOffset,
  demoteScoreBeforeRaceStart,
  extractHeuristicMarkers,
  filterMarkersInDuration,
  formatCommentaryMarkersForPrompt,
  mergeCommentaryMarkers,
  segmentsWithoutHeuristicMatch,
  type AudioTranscriptSegment,
  type CommentaryMarker,
} from "@/src/domain/commentary-markers";

const segments: AudioTranscriptSegment[] = [
  { startMs: 10_000, endMs: 12_000, text: "sto commentando la formation" },
  { startMs: 45_000, endMs: 47_000, text: "Inizia la gara" },
  { startMs: 120_000, endMs: 122_000, text: "giro 3, battaglia con il P2" },
  { startMs: 180_000, endMs: 182_000, text: "lap 5 under pressure" },
  { startMs: 600_000, endMs: 602_000, text: "fine gara, bandiera a scacchi" },
  { startMs: 90_000, endMs: 92_000, text: "che bel sorpasso in salita" },
];

describe("commentary-markers", () => {
  it("applies offset to transcript segments", () => {
    const shifted = applyCommentaryOffset(
      [{ startMs: 1_000, endMs: 2_000, text: "ciao" }],
      5_000,
    );
    expect(shifted).toEqual([{ startMs: 6_000, endMs: 7_000, text: "ciao" }]);
  });

  it("extracts race_start, lap, and race_end heuristics", () => {
    const markers = extractHeuristicMarkers(segments);
    expect(markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "race_start",
          timeMs: 45_000,
          source: "heuristic",
          rawText: "Inizia la gara",
        }),
        expect.objectContaining({
          kind: "lap",
          lapNumber: 3,
          timeMs: 120_000,
          source: "heuristic",
        }),
        expect.objectContaining({
          kind: "lap",
          lapNumber: 5,
          timeMs: 180_000,
          source: "heuristic",
        }),
        expect.objectContaining({
          kind: "race_end",
          timeMs: 600_000,
          source: "heuristic",
        }),
      ]),
    );
  });

  it("returns unmatched segments for LLM pass", () => {
    const unmatched = segmentsWithoutHeuristicMatch(segments);
    expect(unmatched.map((s) => s.text)).toEqual([
      "sto commentando la formation",
      "che bel sorpasso in salita",
    ]);
  });

  it("drops markers outside video duration", () => {
    const markers: CommentaryMarker[] = [
      {
        kind: "race_start",
        timeMs: 45_000,
        rawText: "inizia",
        source: "heuristic",
      },
      {
        kind: "lap",
        timeMs: 900_000,
        rawText: "giro 99",
        source: "heuristic",
        lapNumber: 99,
      },
      {
        kind: "race_end",
        timeMs: -100,
        rawText: "fine",
        source: "llm",
      },
    ];
    expect(filterMarkersInDuration(markers, 700_000)).toEqual([
      markers[0],
    ]);
  });

  it("merges LLM markers with heuristic wins on near-duplicate kind+time", () => {
    const heuristic: CommentaryMarker[] = [
      {
        kind: "race_start",
        timeMs: 45_000,
        rawText: "Inizia la gara",
        source: "heuristic",
      },
    ];
    const llm: CommentaryMarker[] = [
      {
        kind: "race_start",
        timeMs: 46_000,
        rawText: "green flag now",
        source: "llm",
      },
      {
        kind: "lap",
        timeMs: 200_000,
        rawText: "inizio terzo giro",
        source: "llm",
        lapNumber: 3,
      },
    ];
    const merged = mergeCommentaryMarkers(heuristic, llm);
    expect(merged).toHaveLength(2);
    expect(merged.find((m) => m.kind === "race_start")?.source).toBe(
      "heuristic",
    );
    expect(merged.find((m) => m.kind === "lap")?.lapNumber).toBe(3);
  });

  it("demotes score when short is mostly before race start", () => {
    const demoted = demoteScoreBeforeRaceStart(0.9, 0, 20_000, 45_000);
    expect(demoted).toBeLessThan(0.9);
    expect(demoteScoreBeforeRaceStart(0.9, 50_000, 70_000, 45_000)).toBe(0.9);
    expect(demoteScoreBeforeRaceStart(0.9, 0, 20_000, null)).toBe(0.9);
  });

  it("formats markers for the editorial prompt", () => {
    const text = formatCommentaryMarkersForPrompt([
      {
        kind: "race_start",
        timeMs: 45_000,
        rawText: "Inizia la gara",
        source: "heuristic",
      },
      {
        kind: "lap",
        timeMs: 120_000,
        rawText: "giro 3",
        source: "heuristic",
        lapNumber: 3,
      },
    ]);
    expect(text).toContain("race_start");
    expect(text).toContain("lap=3");
    expect(text).toContain("0:45");
  });
});
