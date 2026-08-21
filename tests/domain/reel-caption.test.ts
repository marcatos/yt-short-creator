import { describe, expect, it } from "vitest";

import { assembleReelCaption } from "@/src/domain/reel-caption";
import {
  resolveItalianReelSource,
  shouldEnqueueReelAfterRender,
} from "@/src/domain/reel-publish-source";
import type { ShortCandidate } from "@/src/domain/entities";

function baseCandidate(
  overrides: Partial<ShortCandidate> = {},
): ShortCandidate {
  return {
    id: "c1",
    origin: "clip",
    status: "ready",
    title: "Battaglia in curva",
    description: "Momento hot lap\n#Shorts #iRacing",
    tags: ["iRacing"],
    score: 0.9,
    provenance: {
      sourceVideoId: "sv1",
      startMs: 0,
      endMs: 30_000,
      hookReason: "overtake",
      crop: { mode: "center_vertical", focusX: 0.5 },
    },
    renderOutputPath: "/tmp/render.mp4",
    voiceOvers: null,
    scheduledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("assembleReelCaption", () => {
  it("builds an Italian CTA toward YouTube without #Shorts", () => {
    const caption = assembleReelCaption({
      title: "Battaglia in curva",
      description: "Momento hot lap\n#Shorts #iRacing",
      youtubeChannelUrl: "https://www.youtube.com/@smarcato42",
      hashtags: ["iRacing", "SimRacing", "Shorts"],
    });

    expect(caption).toContain("Battaglia in curva");
    expect(caption).toContain("https://www.youtube.com/@smarcato42");
    expect(caption).toContain("#iRacing");
    expect(caption).not.toMatch(/#Shorts/i);
    expect(caption.length).toBeLessThanOrEqual(2200);
  });
});

describe("resolveItalianReelSource", () => {
  it("prefers the Italian VO render when present", () => {
    const source = resolveItalianReelSource(
      baseCandidate({
        voiceOvers: [
          {
            language: "it",
            title: "Titolo IT",
            description: "Desc IT",
            audioPath: "/a.it.mp3",
            assPath: "/a.it.ass",
            srtPath: "/a.it.srt",
            words: [],
            renderOutputPath: "/it-render.mp4",
          },
          {
            language: "en",
            title: "EN title",
            description: "EN desc",
            audioPath: "/a.en.mp3",
            assPath: "/a.en.ass",
            srtPath: "/a.en.srt",
            words: [],
            renderOutputPath: "/en-render.mp4",
          },
        ],
      }),
    );

    expect(source?.filePath).toBe("/it-render.mp4");
    expect(source?.title).toBe("Titolo IT");
  });
});

describe("shouldEnqueueReelAfterRender", () => {
  it("enqueues only after the Italian VO render completes", () => {
    const voiceOvers = [
      {
        language: "it" as const,
        title: "IT",
        description: "IT",
        audioPath: "/a.it.mp3",
        assPath: "/a.it.ass",
        srtPath: "/a.it.srt",
        words: [],
      },
      {
        language: "en" as const,
        title: "EN",
        description: "EN",
        audioPath: "/a.en.mp3",
        assPath: "/a.en.ass",
        srtPath: "/a.en.srt",
        words: [],
      },
    ];

    expect(shouldEnqueueReelAfterRender("it", voiceOvers)).toBe(true);
    expect(shouldEnqueueReelAfterRender("en", voiceOvers)).toBe(false);
    expect(shouldEnqueueReelAfterRender(undefined, null)).toBe(true);
  });
});
