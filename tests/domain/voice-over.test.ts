import { describe, expect, it } from "vitest";
import {
  buildAssKaraoke,
  buildSrt,
  chunkNarration,
  hashVoiceScript,
  offsetWords,
} from "@/src/domain/voice-over";

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

describe("chunkNarration", () => {
  const sentence = (index: number) => `Frase numero ${index} del capitolo.`;

  it("keeps chapters together while they fit the word budget", () => {
    expect(chunkNarration(["uno due tre", "quattro cinque"], 10)).toEqual([
      "uno due tre\n\nquattro cinque",
    ]);
  });

  it("starts a new chunk before exceeding the budget", () => {
    expect(chunkNarration(["uno due tre", "quattro cinque"], 4)).toEqual([
      "uno due tre",
      "quattro cinque",
    ]);
  });

  it("splits an oversized chapter on sentence boundaries", () => {
    const chapter = [sentence(1), sentence(2), sentence(3)].join(" ");

    const chunks = chunkNarration([chapter], 10);

    expect(chunks).toEqual([
      `${sentence(1)} ${sentence(2)}`,
      sentence(3),
    ]);
  });

  it("hard-splits a single sentence longer than the budget", () => {
    const chunks = chunkNarration(["uno due tre quattro cinque"], 2);

    expect(chunks).toEqual(["uno due", "tre quattro", "cinque"]);
  });

  it("drops blank chapters", () => {
    expect(chunkNarration(["  ", "uno"], 5)).toEqual(["uno"]);
  });
});

describe("offsetWords", () => {
  it("shifts word timings onto the concatenated timeline", () => {
    expect(
      offsetWords([{ text: "due", startMs: 100, endMs: 400 }], 60_000),
    ).toEqual([{ text: "due", startMs: 60_100, endMs: 60_400 }]);
  });

  it("returns the words untouched at offset zero", () => {
    const words = [{ text: "uno", startMs: 0, endMs: 300 }];

    expect(offsetWords(words, 0)).toEqual(words);
  });
});
