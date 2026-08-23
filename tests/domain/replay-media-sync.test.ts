import { describe, expect, it } from "vitest";

import type { ReplaySession } from "@/src/domain/entities";
import {
  isReplayAnalysisStale,
  replayMediaChanged,
  stripReplayDerivedArtifacts,
} from "@/src/domain/replay-media-sync";

function session(overrides: Partial<ReplaySession> = {}): ReplaySession {
  const now = new Date("2026-08-21T10:00:00.000Z");
  return {
    id: "rs-1",
    rpyPath: null,
    ibtPath: null,
    mediaPath: "C:/old.mkv",
    commentaryPath: null,
    commentaryOffsetMs: 0,
    trackName: "Oschersleben",
    focusCarIdx: null,
    title: "Race",
    durationSec: 932,
    status: "ready",
    events: [
      {
        id: "e1",
        type: "overtake",
        startMs: 1,
        endMs: 2,
        score: 0.8,
        hookReason: "overtake",
      },
    ],
    racePackage: { titleIt: "t", titleEn: "t", descriptionIt: "d", descriptionEn: "d" },
    raceAnalysis: {
      focusCarHint: "focus",
      context: { simulator: null, track: "Oschersleben", car: "GR86", durationSec: 1010 },
      results: {},
      recurringRivals: [],
      events: [],
      storylines: [],
      shortScores: [],
      hudTimeline: [],
      commentaryMarkers: [],
    },
    fullVideoEncodePath: "C:/encode.mp4",
    fullVideoYoutubeId: null,
    fullVideoPrivacy: null,
    fullVideoPublishedAt: null,
    fullVoiceOvers: [],
    deliveryAssets: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("replay-media-sync", () => {
  it("detects media path changes case-insensitively", () => {
    expect(replayMediaChanged("C:/foo.mkv", "c:\\foo.mkv")).toBe(false);
    expect(replayMediaChanged("C:/old.mkv", "C:/new.mkv")).toBe(true);
    expect(replayMediaChanged(null, "C:/new.mkv")).toBe(false);
  });

  it("strips derived artefacts when media is swapped", () => {
    const stripped = stripReplayDerivedArtifacts(session());
    expect(stripped.trackName).toBeNull();
    expect(stripped.raceAnalysis).toBeNull();
    expect(stripped.fullVideoEncodePath).toBeNull();
    expect(stripped.events).toEqual([]);
  });

  it("flags stale analysis when duration diverges from media", () => {
    expect(isReplayAnalysisStale(session())).toBe(true);
    expect(
      isReplayAnalysisStale(
        session({
          raceAnalysis: {
            ...session().raceAnalysis!,
            context: {
              ...session().raceAnalysis!.context,
              durationSec: 932,
            },
          },
        }),
      ),
    ).toBe(false);
  });
});
