import { describe, expect, it } from "vitest";

import {
  defaultTitleFromRpyPath,
  shouldPreferTelemetry,
  windowAroundEvent,
} from "@/src/domain/replay";

describe("replay domain helpers", () => {
  it("derives a title from an rpy path", () => {
    expect(defaultTitleFromRpyPath("C:\\iRacing\\replays\\imola-race.rpy")).toBe(
      "imola-race",
    );
  });

  it("prefers telemetry when strong events exist", () => {
    expect(
      shouldPreferTelemetry([
        {
          id: "1",
          type: "incident",
          startMs: 10_000,
          endMs: 10_000,
          score: 0.7,
          hookReason: "spin",
        },
      ]),
    ).toBe(true);
    expect(
      shouldPreferTelemetry([
        {
          id: "1",
          type: "llm_moment",
          startMs: 10_000,
          endMs: 20_000,
          score: 0.9,
          hookReason: "llm",
        },
      ]),
    ).toBe(false);
  });

  it("pads and clamps event windows to short length", () => {
    const window = windowAroundEvent(
      { startMs: 30_000, endMs: 31_000 },
      120,
    );
    expect(window.endMs - window.startMs).toBeGreaterThanOrEqual(8_000);
    expect(window.endMs - window.startMs).toBeLessThanOrEqual(60_000);
    expect(window.startMs).toBeGreaterThanOrEqual(0);
  });
});
