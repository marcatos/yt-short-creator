import {
  detectBattleWindows,
  detectCalloutWindows,
  detectRaceEndMs,
  type HudBattleWindow,
} from "./race-hud";
import type {
  RaceAnalysis,
  RaceAnalysisEvent,
  RaceEventKind,
} from "./race-analysis";

export const COMMENTARY_SPEECH_CUE_KINDS = [
  "race_start",
  "race_end",
  "incident",
  "mistake",
  "overtake",
  "battle",
  "defense",
  "callout",
  "pace_change",
  "tyre",
  "strategy",
  "timeline",
  "lap",
  "other",
] as const;

export type CommentarySpeechCueKind = (typeof COMMENTARY_SPEECH_CUE_KINDS)[number];

export type CommentarySpeechCue = {
  cueId: string;
  targetMs: number;
  endMs: number | null;
  kind: CommentarySpeechCueKind;
  label: string;
  summary: string;
  involvingFocusCar: boolean;
  targetWordsMin: number;
  targetWordsMax: number;
};

const MIN_CUE_GAP_MS = 8_000;
const MAX_CUES = 48;
const MIN_CUES_FOR_SYNC = 4;

const KIND_PRIORITY: Record<CommentarySpeechCueKind, number> = {
  race_start: 100,
  race_end: 100,
  incident: 95,
  mistake: 90,
  overtake: 88,
  callout: 86,
  battle: 84,
  defense: 82,
  pace_change: 70,
  tyre: 55,
  strategy: 50,
  timeline: 40,
  lap: 35,
  other: 30,
};

const ANTICIPATION_MS: Partial<Record<CommentarySpeechCueKind, number>> = {
  overtake: 1_200,
  battle: 1_000,
  callout: 1_000,
  defense: 1_000,
  incident: 800,
  mistake: 800,
};

function wordsForKind(kind: CommentarySpeechCueKind): {
  min: number;
  max: number;
} {
  switch (kind) {
    case "race_start":
    case "race_end":
      return { min: 8, max: 22 };
    case "lap":
      return { min: 4, max: 12 };
    case "incident":
    case "mistake":
    case "overtake":
    case "battle":
    case "callout":
    case "defense":
      return { min: 8, max: 32 };
    default:
      return { min: 6, max: 24 };
  }
}

function mapEventKind(kind: RaceEventKind): CommentarySpeechCueKind {
  if (kind === "other") return "other";
  return kind;
}

function cueFromEvent(event: RaceAnalysisEvent, index: number): CommentarySpeechCue {
  const kind = mapEventKind(event.kind);
  const anticipation = ANTICIPATION_MS[kind] ?? 0;
  const words = wordsForKind(kind);
  return {
    cueId: `event-${index}-${event.startMs}`,
    targetMs: Math.max(0, event.startMs - anticipation),
    endMs: event.endMs,
    kind,
    label: `${kind} @ ${formatClock(event.startMs)}`,
    summary: event.summary,
    involvingFocusCar: event.involvingFocusCar,
    targetWordsMin: words.min,
    targetWordsMax: words.max,
  };
}

function cueFromHudWindow(
  window: HudBattleWindow,
  kind: "battle" | "callout",
  index: number,
): CommentarySpeechCue {
  const words = wordsForKind(kind);
  const anticipation = ANTICIPATION_MS[kind] ?? 0;
  return {
    cueId: `${kind}-${index}-${window.startMs}`,
    targetMs: Math.max(0, window.startMs - anticipation),
    endMs: window.endMs,
    kind,
    label: `${kind} @ ${formatClock(window.startMs)}`,
    summary: window.summary,
    involvingFocusCar: true,
    targetWordsMin: words.min,
    targetWordsMax: words.max,
  };
}

function formatClock(ms: number): string {
  const totalSec = Math.floor(ms / 1_000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function shouldUseCuedCommentaryScripts(
  analysis: RaceAnalysis,
  voiceOverMode: "driver" | "commentator",
): boolean {
  if (voiceOverMode !== "commentator") return false;
  return buildCommentarySpeechCues(analysis).length >= MIN_CUES_FOR_SYNC;
}

export function buildCommentarySpeechCues(
  analysis: RaceAnalysis,
): CommentarySpeechCue[] {
  const raw: CommentarySpeechCue[] = [];

  for (const [index, event] of analysis.events.entries()) {
    raw.push(cueFromEvent(event, index));
  }

  for (const [index, entry] of analysis.timeline.entries()) {
    const words = wordsForKind("timeline");
    raw.push({
      cueId: `timeline-${index}-${entry.startMs}`,
      targetMs: entry.startMs,
      endMs: entry.endMs,
      kind: "timeline",
      label: `beat @ ${formatClock(entry.startMs)}`,
      summary: entry.summary,
      involvingFocusCar: entry.involvingFocusCar,
      targetWordsMin: words.min,
      targetWordsMax: words.max,
    });
  }

  for (const [index, marker] of (analysis.commentaryMarkers ?? []).entries()) {
    const kind =
      marker.kind === "race_start"
        ? "race_start"
        : marker.kind === "race_end"
          ? "race_end"
          : "lap";
    const words = wordsForKind(kind);
    raw.push({
      cueId: `marker-${index}-${marker.timeMs}`,
      targetMs: marker.timeMs,
      endMs: null,
      kind,
      label: `${kind} @ ${formatClock(marker.timeMs)}`,
      summary: marker.rawText,
      involvingFocusCar: true,
      targetWordsMin: words.min,
      targetWordsMax: words.max,
    });
  }

  const hud = analysis.hudTimeline ?? [];
  if (hud.length > 0) {
    const raceEndMs = detectRaceEndMs(hud);
    const battles = detectBattleWindows(hud, undefined, raceEndMs);
    const callouts = detectCalloutWindows(hud, raceEndMs);
    for (const [index, window] of battles.entries()) {
      raw.push(cueFromHudWindow(window, "battle", index));
    }
    for (const [index, window] of callouts.entries()) {
      raw.push(cueFromHudWindow(window, "callout", index));
    }
  }

  return thinSpeechCues(raw);
}

/** Sort, dedupe nearby cues, and cap count while preserving high-priority moments. */
export function thinSpeechCues(cues: CommentarySpeechCue[]): CommentarySpeechCue[] {
  const sorted = [...cues].sort((a, b) => {
    if (a.targetMs !== b.targetMs) return a.targetMs - b.targetMs;
    return KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind];
  });

  const kept: CommentarySpeechCue[] = [];
  for (const cue of sorted) {
    const last = kept[kept.length - 1];
    if (last && cue.targetMs - last.targetMs < MIN_CUE_GAP_MS) {
      if (KIND_PRIORITY[cue.kind] <= KIND_PRIORITY[last.kind]) continue;
      kept.pop();
    }
    kept.push(cue);
  }

  if (kept.length <= MAX_CUES) return kept;

  const stride = Math.ceil(kept.length / MAX_CUES);
  return kept.filter((_, index) => index % stride === 0).slice(0, MAX_CUES);
}
