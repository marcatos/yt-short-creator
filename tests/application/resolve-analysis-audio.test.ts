import { describe, expect, it } from "vitest";

import { resolveAnalysisAudio } from "@/src/application/resolve-analysis-audio";

describe("resolveAnalysisAudio", () => {
  it("prefers commentary when path is set", () => {
    expect(
      resolveAnalysisAudio({
        commentaryPath: "C:/audio/comment.wav",
        commentaryOffsetMs: 1500,
        muxedAudioPath: "C:/proxy/audio.mp3",
      }),
    ).toEqual({
      kind: "commentary",
      path: "C:/audio/comment.wav",
      offsetMs: 1500,
    });
  });

  it("falls back to muxed audio when commentary is missing", () => {
    expect(
      resolveAnalysisAudio({
        commentaryPath: null,
        muxedAudioPath: "C:/proxy/audio.mp3",
      }),
    ).toEqual({
      kind: "muxed",
      path: "C:/proxy/audio.mp3",
      offsetMs: 0,
    });
  });
});
