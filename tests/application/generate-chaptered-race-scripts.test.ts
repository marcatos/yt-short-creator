import { describe, expect, it } from "vitest";

import {
  alignChapterLabels,
  createGenerateChapteredRaceScripts,
} from "@/src/application/generate-chaptered-race-scripts";
import type { CommentaryTimelineChapter } from "@/src/domain/commentary-timeline-segments";
import type { RaceAnalysis } from "@/src/domain/race-analysis";
import type { Logger } from "@/src/ports/logger";

const timelineChapters: CommentaryTimelineChapter[] = [
  {
    label: "Lap 1 / start (00:00)",
    startMs: 0,
    endMs: 90_000,
    summaries: ["Start"],
    events: [],
    targetWordsMin: 40,
    targetWordsMax: 80,
  },
  {
    label: "Race segment 2 (01:30)",
    startMs: 90_000,
    endMs: 180_000,
    summaries: ["Battle"],
    events: [],
    targetWordsMin: 40,
    targetWordsMax: 80,
  },
];

const analysis = {
  context: { durationSec: 180, track: "Test", car: "GR86", simulator: "iRacing" },
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

describe("generateChapteredRaceScripts", () => {
  it("alignChapterLabels restores timeline labels", () => {
    const aligned = alignChapterLabels(
      [
        { label: "wrong", scriptIt: "a", scriptEn: "b" },
        { label: "also wrong", scriptIt: "c", scriptEn: "d" },
      ],
      timelineChapters,
    );
    expect(aligned[0]!.label).toBe(timelineChapters[0]!.label);
    expect(aligned[1]!.label).toBe(timelineChapters[1]!.label);
  });

  it("runs draft then continuity revision", async () => {
    let call = 0;
    const generate = createGenerateChapteredRaceScripts({
      logger: logger(),
      llm: {
        async complete() {
          call += 1;
          if (call === 1) {
            return JSON.stringify({
              chapters: [
                {
                  label: timelineChapters[0]!.label,
                  scriptIt: "Benvenuti alla gara uno",
                  scriptEn: "Welcome to race one",
                },
                {
                  label: timelineChapters[1]!.label,
                  scriptIt: "Benvenuti ancora segmento due",
                  scriptEn: "Welcome again segment two",
                },
              ],
            });
          }
          return JSON.stringify({
            chapters: [
              {
                label: timelineChapters[0]!.label,
                scriptIt: "Partenza veloce in testa al gruppo",
                scriptEn: "Fast start at the front of the pack",
              },
              {
                label: timelineChapters[1]!.label,
                scriptIt: "Dopo quella partenza, il duello si accende",
                scriptEn: "After that start, the battle heats up",
              },
            ],
          });
        },
      },
    });

    const result = await generate({
      analysis,
      chapters: timelineChapters,
      voiceOverMode: "commentator",
    });

    expect(call).toBe(2);
    expect(result[1]!.scriptIt).toContain("Dopo quella partenza");
  });
});
