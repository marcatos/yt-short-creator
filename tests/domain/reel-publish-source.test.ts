import { describe, expect, it } from "vitest";

import type { ShortCandidate } from "@/src/domain/entities";
import {
  resolveItalianReelSource,
  shouldEnqueueReelAfterRender,
} from "@/src/domain/reel-publish-source";

const now = new Date("2026-08-19T10:00:00.000Z");

function baseCandidate(
  overrides: Partial<ShortCandidate> = {},
): ShortCandidate {
  return {
    id: "candidate-1",
    origin: "clip",
    status: "ready",
    title: "Titolo base",
    description: "Descrizione base",
    tags: [],
    score: 1,
    provenance: {
      sourceVideoId: "source-1",
      startMs: 0,
      endMs: 1_000,
      hookReason: "Test",
      crop: { mode: "center_vertical", focusX: 0.5 },
    },
    renderOutputPath: null,
    scheduledAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("reel publish source", () => {
  it("prefers the Italian voice-over render path", () => {
    const candidate = baseCandidate({
      renderOutputPath: "media/renders/single.mp4",
      voiceOvers: [
        {
          language: "it",
          script: "Script IT",
          title: "Titolo IT",
          description: "Descrizione IT",
          voiceProfile: "ash",
          audioPath: "media/voice/it.mp3",
          words: [],
          srtPath: "media/voice/it.srt",
          assPath: "media/voice/it.ass",
          scriptHash: "it-hash",
          renderOutputPath: "media/renders/vo-it.mp4",
        },
        {
          language: "en",
          script: "Script EN",
          title: "Title EN",
          description: "Description EN",
          voiceProfile: "coral",
          audioPath: "media/voice/en.mp3",
          words: [],
          srtPath: "media/voice/en.srt",
          assPath: "media/voice/en.ass",
          scriptHash: "en-hash",
          renderOutputPath: "media/renders/vo-en.mp4",
        },
      ],
    });

    expect(resolveItalianReelSource(candidate)).toEqual({
      filePath: "media/renders/vo-it.mp4",
      title: "Titolo IT",
      description: "Descrizione IT",
    });
  });

  it("falls back to the single render path when no VO package exists", () => {
    const candidate = baseCandidate({
      renderOutputPath: "media/renders/single.mp4",
    });

    expect(resolveItalianReelSource(candidate)).toEqual({
      filePath: "media/renders/single.mp4",
      title: "Titolo base",
      description: "Descrizione base",
    });
  });

  it("returns null when no Italian render is ready", () => {
    expect(resolveItalianReelSource(baseCandidate())).toBeNull();
  });

  it("enqueues Reels only for Italian VO renders", () => {
    const voiceOvers = [
      { language: "it" as const },
      { language: "en" as const },
    ];

    expect(shouldEnqueueReelAfterRender("it", voiceOvers)).toBe(true);
    expect(shouldEnqueueReelAfterRender("en", voiceOvers)).toBe(false);
    expect(shouldEnqueueReelAfterRender(undefined, voiceOvers)).toBe(false);
  });

  it("enqueues Reels for non-VO renders once", () => {
    expect(shouldEnqueueReelAfterRender(undefined, undefined)).toBe(true);
    expect(shouldEnqueueReelAfterRender(undefined, [])).toBe(true);
    expect(shouldEnqueueReelAfterRender("it", [])).toBe(false);
  });
});
