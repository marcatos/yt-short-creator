import { describe, expect, it } from "vitest";

import {
  battleWindowsToEvents,
  boostScoreNearHudBattles,
  collectRecurringRivals,
  detectBattleWindows,
  inferResultsFromHud,
  resolveFocusSubject,
  sliceHudWindow,
  type RaceHudSnapshot,
  type RaceHudTimeline,
} from "@/src/domain/race-hud";

function snap(partial: Partial<RaceHudSnapshot> & { timeMs: number }): RaceHudSnapshot {
  return {
    timeMs: partial.timeMs,
    session: partial.session ?? null,
    focus: partial.focus ?? null,
    battle: partial.battle ?? null,
    standings: partial.standings ?? null,
    confidence: partial.confidence ?? "verified",
  };
}

function sampleTimeline(): RaceHudTimeline {
  return [
    snap({
      timeMs: 0,
      focus: {
        carNumber: 7,
        driverName: "Simone Marcato",
        position: 5,
        fieldSize: 19,
        lastLap: null,
        bestLap: null,
        gapToLeader: "+2.10s",
      },
      standings: {
        rows: [
          { position: 1, carNumber: 4, driverName: "Yoan", gapText: "LEADER" },
          { position: 5, carNumber: 7, driverName: "Simone Marcato", gapText: "+2.10s" },
        ],
      },
      battle: {
        rows: [
          { role: "ahead", carNumber: 4, driverName: "Yoan", gapSec: -2.1 },
          { role: "focus", carNumber: 7, driverName: "Simone Marcato", gapSec: 0 },
          { role: "behind", carNumber: 5, driverName: "Kike", gapSec: 1.5 },
        ],
      },
    }),
    snap({
      timeMs: 4_000,
      focus: {
        carNumber: 7,
        driverName: "Simone Marcato",
        position: 2,
        fieldSize: 19,
        lastLap: "1:41.143",
        bestLap: null,
        gapToLeader: "+0.86s",
      },
      battle: {
        rows: [
          { role: "ahead", carNumber: 4, driverName: "Yoan", gapSec: -0.86 },
          { role: "focus", carNumber: 7, driverName: "Simone Marcato", gapSec: 0 },
          { role: "behind", carNumber: 5, driverName: "Kike", gapSec: 0.06 },
        ],
      },
      standings: {
        rows: [
          { position: 1, carNumber: 4, driverName: "Yoan", gapText: "LEADER" },
          { position: 2, carNumber: 7, driverName: "Simone Marcato", gapText: "+0.86s" },
          { position: 3, carNumber: 5, driverName: "Kike", gapText: "+0.92s" },
        ],
      },
    }),
    snap({
      timeMs: 8_000,
      focus: {
        carNumber: 7,
        driverName: "Simone Marcato",
        position: 2,
        fieldSize: 19,
        lastLap: "1:41.143",
        bestLap: null,
        gapToLeader: "+0.80s",
      },
      battle: {
        rows: [
          { role: "ahead", carNumber: 4, driverName: "Yoan", gapSec: -0.8 },
          { role: "focus", carNumber: 7, driverName: "Simone Marcato", gapSec: 0 },
          { role: "behind", carNumber: 5, driverName: "Kike", gapSec: 0.1 },
        ],
      },
    }),
    snap({
      timeMs: 20_000,
      focus: {
        carNumber: 7,
        driverName: "Simone Marcato",
        position: 2,
        fieldSize: 19,
        lastLap: null,
        bestLap: null,
        gapToLeader: "+1.50s",
      },
      battle: {
        rows: [
          { role: "ahead", carNumber: 4, driverName: "Yoan", gapSec: -1.5 },
          { role: "focus", carNumber: 7, driverName: "Simone Marcato", gapSec: 0 },
          { role: "behind", carNumber: 5, driverName: "Kike", gapSec: 2.0 },
        ],
      },
    }),
  ];
}

describe("race-hud", () => {
  it("resolves focus subject by majority Focus card", () => {
    const subject = resolveFocusSubject(sampleTimeline(), "fallback livery");
    expect(subject.carNumber).toBe(7);
    expect(subject.driverName).toBe("Simone Marcato");
    expect(subject.hint).toContain("#7");
    expect(subject.hint).toContain("Simone Marcato");
  });

  it("infers start/finish/fieldSize from HUD when base is null", () => {
    const results = inferResultsFromHud(sampleTimeline(), 7);
    expect(results.startPosition).toBe(5);
    expect(results.finishPosition).toBe(2);
    expect(results.fieldSize).toBe(19);
    expect(results.positionsGained).toBe(3);
  });

  it("does not overwrite verified base results", () => {
    const results = inferResultsFromHud(sampleTimeline(), 7, {
      qualiResult: "ok",
      startPosition: 18,
      finishPosition: 8,
      fieldSize: 20,
      positionsGained: 10,
    });
    expect(results.startPosition).toBe(18);
    expect(results.finishPosition).toBe(8);
    expect(results.fieldSize).toBe(20);
    expect(results.positionsGained).toBe(10);
  });

  it("detects battle windows when gaps are tight", () => {
    const windows = detectBattleWindows(sampleTimeline(), 1.0);
    expect(windows.length).toBeGreaterThanOrEqual(1);
    expect(windows[0]!.startMs).toBe(4_000);
    expect(windows[0]!.endMs).toBeGreaterThanOrEqual(8_000);
    const events = battleWindowsToEvents(windows);
    expect(events[0]!.kind).toBe("battle");
    expect(events[0]!.confidence).toBe("verified");
  });

  it("slices HUD window by time range", () => {
    const sliced = sliceHudWindow(sampleTimeline(), 3_000, 9_000);
    expect(sliced.map((s) => s.timeMs)).toEqual([4_000, 8_000]);
  });

  it("collects recurring rivals excluding focus car", () => {
    const rivals = collectRecurringRivals(sampleTimeline(), 7, 5);
    expect(rivals.some((r) => r.includes("#4"))).toBe(true);
    expect(rivals.every((r) => !r.includes("#7 Simone"))).toBe(true);
  });

  it("boosts short score near HUD battle windows", () => {
    const windows = detectBattleWindows(sampleTimeline(), 1.0);
    const boosted = boostScoreNearHudBattles(0.8, 3_000, 12_000, windows);
    expect(boosted).toBeGreaterThan(0.8);
    const far = boostScoreNearHudBattles(0.8, 100_000, 115_000, windows);
    expect(far).toBe(0.8);
  });
});
