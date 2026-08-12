import { describe, expect, it } from "vitest";
import {
  buildAssKaraoke,
  buildSrt,
  chunkNarration,
  hashVoiceScript,
  offsetWords,
  TTS_CHUNK_LIMITS,
} from "@/src/domain/voice-over";

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

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

  it("advances ASS one short cue at a time instead of dumping the whole script", () => {
    const long = [
      { text: "Qualifica", startMs: 0, endMs: 400 },
      { text: "pessima", startMs: 400, endMs: 800 },
      { text: "parto", startMs: 800, endMs: 1_100 },
      { text: "diciottesimo", startMs: 1_100, endMs: 1_700 },
      { text: "e", startMs: 3_500, endMs: 3_600 },
      { text: "rimonto", startMs: 3_600, endMs: 4_100 },
      { text: "fino", startMs: 4_100, endMs: 4_400 },
      { text: "all'ottavo", startMs: 4_400, endMs: 5_000 },
    ];
    const ass = buildAssKaraoke(long);
    const dialogues = ass
      .split("\n")
      .filter((line) => line.startsWith("Dialogue:"));
    expect(dialogues.length).toBeGreaterThan(1);
    expect(dialogues[0]).toContain("0:00:00.00");
    expect(dialogues[0]).not.toContain("rimonto");
    expect(dialogues.some((line) => line.includes("rimonto"))).toBe(true);
  });

  it("escapes ASS control characters in spoken words", () => {
    const ass = buildAssKaraoke([
      { text: "curva{1}", startMs: 0, endMs: 400 },
    ]);
    expect(ass).toContain("curva\\{1\\}");
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
  const limits = (maxWords: number, maxChars = 10_000) => ({
    maxWords,
    maxChars,
  });

  it("keeps chapters together while they fit the word budget", () => {
    expect(chunkNarration(["uno due tre", "quattro cinque"], limits(10))).toEqual(
      ["uno due tre\n\nquattro cinque"],
    );
  });

  it("starts a new chunk before exceeding the budget", () => {
    expect(chunkNarration(["uno due tre", "quattro cinque"], limits(4))).toEqual([
      "uno due tre",
      "quattro cinque",
    ]);
  });

  it("splits an oversized chapter on sentence boundaries", () => {
    const chapter = [sentence(1), sentence(2), sentence(3)].join(" ");

    const chunks = chunkNarration([chapter], limits(10));

    expect(chunks).toEqual([
      `${sentence(1)} ${sentence(2)}`,
      sentence(3),
    ]);
  });

  it("hard-splits a single sentence longer than the budget", () => {
    const chunks = chunkNarration(["uno due tre quattro cinque"], limits(2));

    expect(chunks).toEqual(["uno due", "tre quattro", "cinque"]);
  });

  it("drops blank chapters", () => {
    expect(chunkNarration(["  ", "uno"], limits(5))).toEqual(["uno"]);
  });

  it("starts a new chunk on the character budget even when words still fit", () => {
    const chunks = chunkNarration(
      ["parolalunghissima parolalunghissima", "coda"],
      { maxWords: 100, maxChars: 36 },
    );

    expect(chunks).toEqual(["parolalunghissima parolalunghissima", "coda"]);
  });

  it("splits Italian chapters that fit the word budget but bust the char cap", () => {
    const chapter = Array.from({ length: 55 }, (_, index) =>
      `Il pilota italiano incrementa progressivamente il distacco cronometrato ${index}.`,
    ).join(" ");

    const chunks = chunkNarration([chapter], TTS_CHUNK_LIMITS);

    expect(wordCount(chapter)).toBeLessThan(TTS_CHUNK_LIMITS.maxWords);
    expect(chapter.length).toBeGreaterThan(TTS_CHUNK_LIMITS.maxChars);
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.every((chunk) => chunk.length <= TTS_CHUNK_LIMITS.maxChars),
    ).toBe(true);
  });

  it("keeps hard-split pieces inside the character cap", () => {
    const runOn = Array.from({ length: 400 }, () => "parola").join(" ");

    const chunks = chunkNarration([runOn], { maxWords: 700, maxChars: 120 });

    expect(chunks.every((chunk) => chunk.length <= 120)).toBe(true);
    expect(chunks.join(" ")).toBe(runOn);
  });

  it("rejects a non-positive character budget", () => {
    expect(() => chunkNarration(["uno"], { maxWords: 10, maxChars: 0 })).toThrow(
      /maxChars/,
    );
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
