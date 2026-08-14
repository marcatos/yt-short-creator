import type { RaceAnalysis } from "./race-analysis";
import {
  renderHardwareBlock,
  type HardwareConfig,
  type HardwareLanguage,
} from "./hardware";
import type { VoiceOverLanguage } from "./voice-over";

export type LocalizedEditorialCopy = {
  language: VoiceOverLanguage;
  title: string;
  description: string;
  /** Spoken VO only — no hardware / hashtags. */
  voiceOverScript: string;
};

export type EditorialPackage = {
  it: LocalizedEditorialCopy;
  en: LocalizedEditorialCopy;
  thumbnailConcept: {
    universalText: string | null;
    textIt: string | null;
    textEn: string | null;
    rationale: string;
  };
};

/**
 * Title priority (highest first): extraordinary result → initial problem +
 * payoff → comeback → battle → unusual event → technique → car/track.
 */
export const TITLE_PRIORITY_GUIDANCE = `
Title priority (pick the strongest true hook):
1) extraordinary result (e.g. P18 → P8)
2) initial problem + payoff (bad quali then comeback)
3) comeback / rimonta
4) battle
5) unusual event
6) interesting technique
7) car/track only as last resort
Do NOT literally translate IT↔EN — write the best title for each audience.
Never promise what is not in the race analysis.
`.trim();

export function formatRaceInfoBlock(
  analysis: RaceAnalysis,
  language: HardwareLanguage,
): string {
  const { context, results } = analysis;
  const lines: string[] = [];
  if (language === "it") {
    if (context.track) lines.push(`Circuito: ${context.track}`);
    if (context.car) lines.push(`Auto: ${context.car}`);
    if (context.simulator) lines.push(`Simulatore: ${context.simulator}`);
    if (results.startPosition != null) {
      lines.push(
        `Partenza: P${results.startPosition}${
          results.fieldSize != null ? `/${results.fieldSize}` : ""
        }`,
      );
    }
    if (results.finishPosition != null) {
      lines.push(`Arrivo: P${results.finishPosition}`);
    }
    if (context.durationSec != null) {
      lines.push(`Durata: ${Math.round(context.durationSec / 60)} min`);
    }
    if (results.qualiResult) lines.push(`Qualifica: ${results.qualiResult}`);
  } else {
    if (context.track) lines.push(`Track: ${context.track}`);
    if (context.car) lines.push(`Car: ${context.car}`);
    if (context.simulator) lines.push(`Simulator: ${context.simulator}`);
    if (results.startPosition != null) {
      lines.push(
        `Start: P${results.startPosition}${
          results.fieldSize != null ? `/${results.fieldSize}` : ""
        }`,
      );
    }
    if (results.finishPosition != null) {
      lines.push(`Finish: P${results.finishPosition}`);
    }
    if (context.durationSec != null) {
      lines.push(`Duration: ${Math.round(context.durationSec / 60)} min`);
    }
    if (results.qualiResult) {
      lines.push(`Qualifying: ${results.qualiResult}`);
    }
  }
  return lines.length ? ["Race info", ...lines].join("\n") : "";
}

export function assembleDescription(input: {
  language: HardwareLanguage;
  hook: string;
  story: string;
  cta: string;
  analysis: RaceAnalysis;
  hardware: HardwareConfig;
  hashtags: string[];
}): string {
  const parts = [
    input.hook.trim(),
    input.story.trim(),
    formatRaceInfoBlock(input.analysis, input.language),
    input.cta.trim(),
    renderHardwareBlock(input.hardware, input.language),
    input.hashtags
      .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
      .join(" "),
  ].filter((part) => part.length > 0);
  return parts.join("\n\n");
}

export function analysisContextForEditorial(analysis: RaceAnalysis): string {
  const hudTimeline = analysis.hudTimeline ?? [];
  const hudSummary =
    hudTimeline.length > 0
      ? {
          snapshotCount: hudTimeline.length,
          focusCarHint: analysis.focusCarHint,
          rivals: analysis.recurringRivals.slice(0, 8),
          sample: hudTimeline
            .filter(
              (_, index) =>
                index %
                  Math.max(1, Math.floor(hudTimeline.length / 6)) ===
                0,
            )
            .slice(0, 6)
            .map((snap) => ({
              timeMs: snap.timeMs,
              focus: snap.focus
                ? {
                    carNumber: snap.focus.carNumber,
                    driverName: snap.focus.driverName,
                    position: snap.focus.position,
                    gapToLeader: snap.focus.gapToLeader,
                  }
                : null,
              battle: snap.battle?.rows.slice(0, 4) ?? null,
              session: snap.session
                ? {
                    lap: snap.session.lap,
                    status: snap.session.status,
                    flag: snap.session.flag,
                  }
                : null,
            })),
        }
      : null;

  return JSON.stringify(
    {
      context: analysis.context,
      results: analysis.results,
      mainStoryline: analysis.mainStoryline,
      whyWatch: analysis.whyWatch,
      storylines: analysis.storylines,
      potentialHooks: analysis.potentialHooks,
      events: analysis.events.slice(0, 40),
      timeline: analysis.timeline,
      narrativeIt: analysis.narrativeIt,
      recurringRivals: analysis.recurringRivals,
      hud: hudSummary,
    },
    null,
    2,
  );
}
