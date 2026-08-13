import { describe, expect, it } from "vitest";

import { extendClipWindowForVoiceOver } from "@/src/adapters/ffmpeg/ffmpeg-render";

describe("extendClipWindowForVoiceOver", () => {
  it("keeps the window when narration fits", () => {
    expect(
      extendClipWindowForVoiceOver({
        startMs: 10_000,
        endMs: 30_000,
        voiceDurationMs: 15_000,
      }),
    ).toEqual({ startMs: 10_000, endMs: 30_000 });
  });

  it("extends forward to cover narration", () => {
    expect(
      extendClipWindowForVoiceOver({
        startMs: 10_000,
        endMs: 18_000,
        voiceDurationMs: 20_000,
      }),
    ).toEqual({ startMs: 10_000, endMs: 30_000 });
  });

  it("pulls start earlier when the source ends before narration", () => {
    expect(
      extendClipWindowForVoiceOver({
        startMs: 90_000,
        endMs: 98_000,
        voiceDurationMs: 20_000,
        sourceDurationMs: 100_000,
      }),
    ).toEqual({ startMs: 80_000, endMs: 100_000 });
  });
});
