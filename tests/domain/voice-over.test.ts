import { describe, expect, it } from "vitest";
import { buildAssKaraoke, buildSrt, hashVoiceScript } from "@/src/domain/voice-over";

describe("voice-over captions", () => {
  const words = [
    { text: "Sorpasso", startMs: 0, endMs: 400 },
    { text: "pulito", startMs: 400, endMs: 900 },
  ];

  it("builds SRT with word-grouped cues", () => {
    const srt = buildSrt(words);
    expect(srt).toContain("00:00:00,000 --> 00:00:00,900");
    expect(srt).toContain("Sorpasso pulito");
  });

  it("builds ASS with per-word timing tags", () => {
    const ass = buildAssKaraoke(words);
    expect(ass).toContain("[Events]");
    expect(ass).toMatch(/\{\\k\d+\}/);
  });

  it("hashes script+voice+lang stably", () => {
    expect(hashVoiceScript("ciao", "coral", "it")).toBe(
      hashVoiceScript("ciao", "coral", "it"),
    );
    expect(hashVoiceScript("ciao", "coral", "it")).not.toBe(
      hashVoiceScript("ciao", "coral", "en"),
    );
  });
});
