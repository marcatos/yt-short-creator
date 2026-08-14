import { describe, expect, it } from "vitest";

import {
  assembleDescription,
  TITLE_PRIORITY_GUIDANCE,
} from "@/src/domain/editorial";
import { DEFAULT_HARDWARE } from "@/src/domain/hardware";
import type { RaceAnalysis } from "@/src/domain/race-analysis";
import { raceAnalysisToRacePackage } from "@/src/domain/race-analysis";
import {
  createYoutubeMetadataDocument,
} from "@/src/domain/youtube-metadata";

/** Canonical Oschersleben vertical-slice fixture from the product spec. */
export function oscherslebenRaceAnalysis(): RaceAnalysis {
  return {
    version: 1,
    focusCarHint: "White/black/green π Toyota GR86",
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
    events: [
      {
        kind: "overtake",
        startMs: 180_000,
        endMs: 210_000,
        summary:
          "Avversari difendono l'interno della chicane; resto fuori e preparo l'incrocio",
        involvingFocusCar: true,
        confidence: "verified",
      },
      {
        kind: "tyre",
        startMs: 700_000,
        endMs: 880_000,
        summary:
          "Negli ultimi giri altri soffrono sottosterzo; gestisco meglio le gomme",
        involvingFocusCar: true,
        confidence: "inferred",
      },
    ],
    timeline: [
      {
        startMs: 0,
        endMs: 60_000,
        summary: "Partenza P18 dopo quali fallita",
        involvingFocusCar: true,
      },
      {
        startMs: 180_000,
        endMs: 210_000,
        summary: "Sorpasso in chicane con switchback",
        involvingFocusCar: true,
      },
      {
        startMs: 700_000,
        endMs: 900_000,
        summary: "Recupero finale con gestione gomme",
        involvingFocusCar: true,
      },
    ],
    storylines: [
      {
        kind: "main",
        summary: "Qualifica sbagliata → P18 → rimonta → P8",
        whyWatch: "Parte P18 e arriva P8 in 15 minuti",
      },
      {
        kind: "secondary",
        summary: "Difendono l'interno → resto fuori → preparo l'incrocio",
        whyWatch: "Mostra un modo intelligente di costruire un sorpasso",
      },
      {
        kind: "final",
        summary: "Gestione gomme migliore nel finale",
        whyWatch: "Recupero posizioni quando gli altri calano di ritmo",
      },
    ],
    mainStoryline: "Qualifica completamente sbagliata → P18 → rimonta → P8",
    whyWatch: "Parte P18 e arriva P8 in 15 minuti",
    potentialHooks: ["P18 → P8", "Qualifica disastrosa"],
    shortCandidates: [
      {
        shortScore: 0.94,
        startMs: 180_000,
        endMs: 215_000,
        hook: "Continuavano a difendere l'interno",
        story: "Resto fuori e preparo l'incrocio",
        payoff: "Passo in chicane",
        recommendedTitleIt:
          "Difendevano l'interno. Così li passavo dall'altra parte.",
        recommendedTitleEn:
          "They kept covering the inside. So I started setting up the switchback.",
        requiresLocalizedRender: true,
        tags: ["iRacing", "GR86", "Oschersleben"],
        descriptionIt: "Sorpasso intelligente in chicane",
        descriptionEn: "Intelligent chicane switchback",
      },
      {
        shortScore: 0.8,
        startMs: 0,
        endMs: 25_000,
        hook: "Parto P18",
        story: "Qualifica da dimenticare",
        payoff: "Inizia la rimonta",
        recommendedTitleIt: "Parto P18 su 20",
        recommendedTitleEn: "Starting P18 of 20",
        requiresLocalizedRender: false,
        tags: ["iRacing"],
        descriptionIt: "Start della rimonta",
        descriptionEn: "Comeback start",
      },
    ],
    narrativeIt:
      "Sbaglio entrambi i giri di qualifica e parto P18 su 20. In 15 minuti rimonto fino alla P8, passando in chicane quando difendono l'interno e gestendo meglio le gomme nel finale.",
    audioTranscript: "",
    hudTimeline: [],
  };
}

describe("Oschersleben vertical slice fixture", () => {
  it("encodes the editorial story and Case A/B short flags", () => {
    const race = oscherslebenRaceAnalysis();
    expect(race.results.positionsGained).toBe(10);
    expect(race.whyWatch).toMatch(/P18/);
    expect(TITLE_PRIORITY_GUIDANCE).toContain("extraordinary result");

    const description = assembleDescription({
      language: "it",
      hook: "Qualifica da dimenticare: parto P18 su 20.",
      story: "Rimonta di 15 minuti fino alla P8.",
      cta: "Iscriviti per le prossime gare.",
      analysis: race,
      hardware: DEFAULT_HARDWARE,
      hashtags: ["iRacing", "GR86"],
    });
    expect(description).toContain("Circuito: Oschersleben");
    expect(description).toContain("LA MIA POSTAZIONE SIM RACING");

    const topShort = [...race.shortCandidates].sort(
      (a, b) => b.shortScore - a.shortScore,
    )[0]!;
    expect(topShort.requiresLocalizedRender).toBe(true);
    expect(
      race.shortCandidates.some((item) => !item.requiresLocalizedRender),
    ).toBe(true);

    const pkg = raceAnalysisToRacePackage(race, {
      title: "DA P18 A P8 IN 15 MINUTI! Rimonta a Oschersleben | iRacing GR86",
      description,
      tags: ["iRacing", "GR86", "Oschersleben"],
    });
    expect(pkg.fullVideo.title).toContain("P18");

    const metadata = createYoutubeMetadataDocument({
      contentKind: "full",
      masterVideo: "delivery/master_video.mp4",
      it: {
        title: "DA P18 A P8 IN 15 MINUTI! Rimonta a Oschersleben | iRacing GR86",
        description,
        audio: "delivery/audio_it.m4a",
        subtitles: "delivery/subtitles_it.srt",
        thumbnail: null,
      },
      en: {
        title: "P18 to P8 in 15 MINUTES! Oschersleben Comeback | iRacing GR86",
        description: "Qualifying disaster → P18 → P8.",
        audio: "delivery/audio_en.m4a",
        subtitles: "delivery/subtitles_en.srt",
        thumbnail: null,
      },
      manualStudioChecklist: ["Attach secondary audio in Studio"],
    });
    expect(metadata.localizations.en.title).toContain("Comeback");
    expect(metadata.manualStudioChecklist).toHaveLength(1);
  });
});
