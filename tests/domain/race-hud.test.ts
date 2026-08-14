import { describe, expect, it } from "vitest";

import {
  battleWindowsToEvents,
  boostScoreNearHudBattles,
  boostScoreNearHudCallouts,
  collectRecurringRivals,
  detectBattleWindows,
  detectCalloutWindows,
  formatHudTimelineForPrompt,
  HUD_CALLOUT_SCORE_BOOST,
  inferResultsFromHud,
  reconcileHudSnapshot,
  resolveFocusSubject,
  sliceHudWindow,
  type FocusCardState,
  type RaceHudSnapshot,
  type RaceHudTimeline,
  type StandingsRow,
} from "@/src/domain/race-hud";

function focus(
  partial: Partial<FocusCardState> &
    Pick<FocusCardState, "carNumber" | "driverName" | "position" | "fieldSize">,
): FocusCardState {
  return {
    lastLap: null,
    bestLap: null,
    gapToLeader: null,
    deltaBest: null,
    fuelPct: null,
    sectors: null,
    ...partial,
  };
}

function standing(
  partial: Omit<StandingsRow, "positionDelta"> & { positionDelta?: number | null },
): StandingsRow {
  return {
    positionDelta: partial.positionDelta ?? null,
    ...partial,
  };
}

function snap(partial: Partial<RaceHudSnapshot> & { timeMs: number }): RaceHudSnapshot {
  return {
    timeMs: partial.timeMs,
    session: partial.session ?? null,
    focus: partial.focus ?? null,
    battle: partial.battle ?? null,
    standings: partial.standings ?? null,
    battleCallout: partial.battleCallout ?? null,
    fieldTicker: partial.fieldTicker ?? null,
    confidence: partial.confidence ?? "verified",
  };
}

function sampleTimeline(): RaceHudTimeline {
  return [
    snap({
      timeMs: 0,
      focus: focus({
        carNumber: 7,
        driverName: "Simone Marcato",
        position: 5,
        fieldSize: 19,
        gapToLeader: "+2.10s",
      }),
      standings: {
        rows: [
          standing({ position: 1, carNumber: 4, driverName: "Yoan", gapText: "LEADER" }),
          standing({
            position: 5,
            carNumber: 7,
            driverName: "Simone Marcato",
            gapText: "+2.10s",
          }),
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
      focus: focus({
        carNumber: 7,
        driverName: "Simone Marcato",
        position: 2,
        fieldSize: 19,
        lastLap: "1:41.143",
        gapToLeader: "+0.86s",
      }),
      battle: {
        rows: [
          { role: "ahead", carNumber: 4, driverName: "Yoan", gapSec: -0.86 },
          { role: "focus", carNumber: 7, driverName: "Simone Marcato", gapSec: 0 },
          { role: "behind", carNumber: 5, driverName: "Kike", gapSec: 0.06 },
        ],
      },
      standings: {
        rows: [
          standing({ position: 1, carNumber: 4, driverName: "Yoan", gapText: "LEADER" }),
          standing({
            position: 2,
            carNumber: 7,
            driverName: "Simone Marcato",
            gapText: "+0.86s",
            positionDelta: 3,
          }),
          standing({ position: 3, carNumber: 5, driverName: "Kike", gapText: "+0.92s" }),
        ],
      },
      battleCallout: {
        contestedPosition: 2,
        rows: [
          { carNumber: 7, driverName: "S. Marcato", gapSec: 0, note: null },
          { carNumber: 2, driverName: "M. Gorissen", gapSec: 0.2, note: "SIDE" },
          { carNumber: 5, driverName: "K. Martin2", gapSec: 0.25, note: null },
        ],
      },
    }),
    snap({
      timeMs: 8_000,
      focus: focus({
        carNumber: 7,
        driverName: "Simone Marcato",
        position: 2,
        fieldSize: 19,
        lastLap: "1:41.143",
        gapToLeader: "+0.80s",
      }),
      battle: {
        rows: [
          { role: "ahead", carNumber: 4, driverName: "Yoan", gapSec: -0.8 },
          { role: "focus", carNumber: 7, driverName: "Simone Marcato", gapSec: 0 },
          { role: "behind", carNumber: 5, driverName: "Kike", gapSec: 0.1 },
        ],
      },
      battleCallout: {
        contestedPosition: 2,
        rows: [
          { carNumber: 7, driverName: "S. Marcato", gapSec: 0, note: null },
          { carNumber: 2, driverName: "M. Gorissen", gapSec: 0.1, note: null },
        ],
      },
      fieldTicker: {
        rows: [
          {
            position: 12,
            carNumber: 12,
            driverName: "Marino Separovic",
            gapText: "+11.14s",
          },
        ],
      },
    }),
    snap({
      timeMs: 20_000,
      focus: focus({
        carNumber: 7,
        driverName: "Simone Marcato",
        position: 2,
        fieldSize: 19,
        gapToLeader: "+1.50s",
      }),
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

  it("detects battle callout windows with contested position summary", () => {
    const windows = detectCalloutWindows(sampleTimeline());
    expect(windows.length).toBe(1);
    expect(windows[0]!.startMs).toBe(4_000);
    expect(windows[0]!.endMs).toBeGreaterThanOrEqual(8_000);
    expect(windows[0]!.summary).toContain("Battle for P2");
    expect(windows[0]!.summary).toContain("#7");
    expect(windows[0]!.minGapSec).toBeLessThanOrEqual(0.2);
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

  it("boosts short score near HUD callout windows more than battles", () => {
    const callouts = detectCalloutWindows(sampleTimeline());
    const boosted = boostScoreNearHudCallouts(0.8, 3_000, 12_000, callouts);
    expect(boosted).toBeCloseTo(0.8 + HUD_CALLOUT_SCORE_BOOST, 5);
  });

  it("reconciles focus position against standings and downgrades confidence", () => {
    const conflicted = snap({
      timeMs: 1_000,
      confidence: "verified",
      focus: focus({
        carNumber: 7,
        driverName: "Simone Marcato",
        position: 4,
        fieldSize: 18,
        gapToLeader: "+6.99s",
      }),
      standings: {
        rows: [
          standing({
            position: 2,
            carNumber: 7,
            driverName: "Simone Marcato",
            gapText: "+6.14s",
          }),
        ],
      },
    });
    const reconciled = reconcileHudSnapshot(conflicted);
    expect(reconciled.focus?.position).toBe(2);
    expect(reconciled.focus?.gapToLeader).toBe("+6.14s");
    expect(reconciled.confidence).toBe("inferred");
  });

  it("formats callout and ticker into FASE A prompt block", () => {
    const block = formatHudTimelineForPrompt(sampleTimeline());
    expect(block).toContain("callout=Battle for P2");
    expect(block).toContain("fieldTicker=");
    expect(block).toContain("Δbest=");
  });
});
