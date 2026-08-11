import { describe, expect, it } from "vitest";

import {
  buildConcatTimeline,
  buildDirectorShotPlan,
  buildIncidentHuntPlan,
} from "@/src/domain/replay-director";
import type { ReplayEvent } from "@/src/domain/entities";

describe("replay director shot plan", () => {
  it("builds anticipated shots from telemetry events sorted by race time", () => {
    const events: ReplayEvent[] = [
      {
        id: "b",
        type: "best_lap",
        startMs: 90_000,
        endMs: 91_000,
        score: 0.8,
        hookReason: "purple",
      },
      {
        id: "a",
        type: "incident",
        startMs: 40_000,
        endMs: 41_000,
        score: 0.95,
        hookReason: "spin",
        payload: { carPosition: 3 },
      },
    ];

    const shots = buildDirectorShotPlan({
      events,
      anticipationMs: 3_000,
      focusCarPosition: 1,
    });

    expect(shots).toHaveLength(2);
    expect(shots[0]?.id).toBe("a");
    expect(shots[0]?.seekMs).toBeLessThan(40_000);
    expect(shots[0]?.carPosition).toBe(3);
    expect(shots[1]?.id).toBe("b");
  });

  it("falls back to incident hunt when telemetry is empty", () => {
    const shots = buildIncidentHuntPlan({ shotCount: 3, focusCarPosition: 2 });
    expect(shots).toHaveLength(3);
    expect(shots.every((shot) => shot.seekMs === -1)).toBe(true);
    expect(shots[0]?.carPosition).toBe(2);
  });

  it("maps segments onto a concatenated timeline", () => {
    const shots = buildIncidentHuntPlan({ shotCount: 2, recordMs: 10_000 });
    const timeline = buildConcatTimeline(shots, [10_000, 12_000]);
    expect(timeline[0]).toMatchObject({ startMs: 0, endMs: 10_000 });
    expect(timeline[1]).toMatchObject({ startMs: 10_000, endMs: 22_000 });
  });
});
