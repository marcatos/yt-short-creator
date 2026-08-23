import { describe, expect, it } from "vitest";

import {
  alignCueScripts,
  createGenerateCuedRaceScripts,
} from "@/src/application/generate-cued-race-scripts";
import type { CommentarySpeechCue } from "@/src/domain/commentary-speech-cues";
import type { RaceAnalysis } from "@/src/domain/race-analysis";
import type { Logger } from "@/src/ports/logger";

const cues: CommentarySpeechCue[] = [
  {
    cueId: "event-0-120000",
    targetMs: 118_800,
    endMs: 125_000,
    kind: "overtake",
    label: "overtake @ 02:00",
    summary: "Pass into T1",
    involvingFocusCar: true,
    targetWordsMin: 8,
    targetWordsMax: 32,
  },
];

const analysis = {
  context: { durationSec: 900, track: "Test", car: "GR86", simulator: "iRacing" },
  mainStoryline: "Battle",
  whyWatch: "Action",
  events: [],
  timeline: [],
  storylines: [],
  potentialHooks: [],
  recurringRivals: [],
  results: {
    qualiResult: null,
    startPosition: 10,
    finishPosition: 5,
    fieldSize: 20,
    positionsGained: 5,
  },
  narrativeIt: "n",
  audioTranscriptSegments: [],
  commentaryMarkers: [],
  hudTimeline: [],
} as unknown as RaceAnalysis;

function logger(): Logger {
  const instance: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child: () => instance,
  };
  return instance;
}

describe("generateCuedRaceScripts", () => {
  it("alignCueScripts fills missing cue ids from summaries", () => {
    const aligned = alignCueScripts(
      [{ cueId: "wrong", scriptIt: "x", scriptEn: "y" }],
      cues,
    );
    expect(aligned[0]!.scriptIt).toBe("Pass into T1");
  });

  it("requests one script line per speech cue", async () => {
    const generate = createGenerateCuedRaceScripts({
      logger: logger(),
      llm: {
        async complete() {
          return JSON.stringify({
            cues: [
              {
                cueId: cues[0]!.cueId,
                scriptIt: "Attacca in curva uno e passa!",
                scriptEn: "Attacks through turn one and passes!",
              },
            ],
          });
        },
      },
    });

    const result = await generate({
      analysis,
      cues,
      voiceOverMode: "commentator",
    });
    expect(result[0]!.scriptIt).toContain("curva");
  });
});
