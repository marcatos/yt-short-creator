import { describe, expect, it } from "vitest";

import { createEditorialLocalize } from "@/src/application/editorial-localize";
import {
  assembleDescription,
  formatRaceInfoBlock,
} from "@/src/domain/editorial";
import { DEFAULT_HARDWARE } from "@/src/domain/hardware";
import type { RaceAnalysis } from "@/src/domain/race-analysis";
import type { Logger } from "@/src/ports/logger";

const analysis: RaceAnalysis = {
  version: 1,
  focusCarHint: "π GR86",
  context: {
    simulator: "iRacing",
    track: "Oschersleben",
    car: "Toyota GR86",
    durationSec: 900,
  },
  results: {
    qualiResult: "both laps invalid",
    startPosition: 18,
    finishPosition: 8,
    fieldSize: 20,
    positionsGained: 10,
  },
  recurringRivals: [],
  events: [],
  timeline: [],
  storylines: [
    {
      kind: "main",
      summary: "Quali disaster → P18 → P8",
      whyWatch: "P18 to P8 in 15 minutes",
    },
  ],
  mainStoryline: "Qualifica sbagliata → P18 → rimonta → P8",
  whyWatch: "Parte P18 e arriva P8 in 15 minuti",
  potentialHooks: ["P18 → P8"],
  shortCandidates: [
    {
      shortScore: 0.9,
      startMs: 0,
      endMs: 20_000,
      hook: "h",
      story: "s",
      payoff: "p",
      recommendedTitleIt: "IT",
      recommendedTitleEn: "EN",
      requiresLocalizedRender: false,
      tags: [],
      descriptionIt: "d",
      descriptionEn: "d",
    },
  ],
  narrativeIt: "Parto P18 e arrivo P8.",
  audioTranscript: "",
  hudTimeline: [],
};

function createLogger(): Logger {
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child: () => logger,
  };
  return logger;
}

describe("editorial description assembly", () => {
  it("includes race info and static hardware without LLM", () => {
    const description = assembleDescription({
      language: "it",
      hook: "Qualifica da dimenticare: parto P18.",
      story: "Rimonto fino alla P8 gestendo meglio le gomme.",
      cta: "Iscriviti per le prossime gare.",
      analysis,
      hardware: DEFAULT_HARDWARE,
      hashtags: ["iRacing", "GR86"],
    });
    expect(description).toContain("Circuito: Oschersleben");
    expect(description).toContain("Partenza: P18/20");
    expect(description).toContain("LA MIA POSTAZIONE SIM RACING");
    expect(description).toContain(DEFAULT_HARDWARE.wheelbase);
    expect(description).toContain("#iRacing");
  });

  it("formats English race info", () => {
    expect(formatRaceInfoBlock(analysis, "en")).toContain("Start: P18/20");
  });
});

describe("editorialLocalize", () => {
  it("builds independent IT/EN copy and appends hardware", async () => {
    const localize = createEditorialLocalize({
      hardware: {
        async get() {
          return DEFAULT_HARDWARE;
        },
        async save() {},
      },
      llm: {
        async complete() {
          return JSON.stringify({
            titleIt: "DA P18 A P8 IN 15 MINUTI! Rimonta a Oschersleben | iRacing GR86",
            titleEn: "P18 to P8 in 15 MINUTES! Oschersleben Comeback | iRacing GR86",
            hookIt: "Qualifica da dimenticare: parto P18 su 20.",
            hookEn: "Qualifying disaster: I start P18 of 20.",
            storyIt: "In 15 minuti rimonto fino alla P8.",
            storyEn: "In 15 minutes I climb to P8.",
            ctaIt: "Iscriviti per le prossime gare.",
            ctaEn: "Subscribe for the next races.",
            voiceOverIt: "Sbaglio la qualifica e parto P18. Poi rimonto fino alla P8.",
            voiceOverEn:
              "I mess up qualifying and start P18. Then I climb all the way to P8.",
            hashtags: ["iRacing", "GR86", "SimRacing"],
            thumbnailUniversal: "P18 → P8",
            thumbnailIt: null,
            thumbnailEn: null,
            thumbnailRationale: "Position swing works in both languages",
          });
        },
      },
      logger: createLogger(),
    });

    const pack = await localize({ analysis });
    expect(pack.it.title).toContain("P18");
    expect(pack.en.title).toContain("Comeback");
    expect(pack.it.title).not.toBe(pack.en.title);
    expect(pack.it.description).toContain("LA MIA POSTAZIONE SIM RACING");
    expect(pack.en.description).toContain("Wheelbase:");
    expect(pack.it.voiceOverScript).not.toContain("LA MIA POSTAZIONE SIM RACING");
    expect(pack.thumbnailConcept.universalText).toBe("P18 → P8");
  });
});
