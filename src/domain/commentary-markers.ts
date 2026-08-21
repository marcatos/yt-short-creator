/**
 * Spoken commentary markers for FASE A (sidecar audio track).
 * Heuristics own known cue phrases; LLM may propose extras that merge with
 * heuristic-wins on near-duplicate kind+time.
 */

export type AnalysisAudioSourceKind = "commentary" | "muxed"; // future: "both"

export type AudioTranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

export const COMMENTARY_MARKER_KINDS = [
  "race_start",
  "lap",
  "race_end",
] as const;

export type CommentaryMarkerKind = (typeof COMMENTARY_MARKER_KINDS)[number];

export type CommentaryMarkerSource = "heuristic" | "llm";

export type CommentaryMarker = {
  kind: CommentaryMarkerKind;
  timeMs: number;
  rawText: string;
  source: CommentaryMarkerSource;
  lapNumber?: number;
};

const PRE_RACE_SCORE_PENALTY = 0.35;
const MARKER_NEAR_MS = 8_000;
const MERGE_NEAR_MS = 5_000;
const LAP_MARKER_SCORE_BOOST = 0.08;

const RACE_START_RE =
  /\b(inizia\s+la\s+gara|semaforo\s+verde|green\s+flag|green\s+light|via[!]?|race\s+start)\b/i;
const RACE_END_RE =
  /\b(fine\s+gara|bandiera\s+a\s+scacchi|checkered(\s+flag)?|chequered(\s+flag)?|race\s+over|finished)\b/i;
const LAP_RE = /\b(?:giro|lap)\s*(\d{1,2})\b/i;

export function applyCommentaryOffset(
  segments: AudioTranscriptSegment[],
  offsetMs: number,
): AudioTranscriptSegment[] {
  if (offsetMs === 0) return segments.map((s) => ({ ...s }));
  return segments.map((s) => ({
    ...s,
    startMs: s.startMs + offsetMs,
    endMs: s.endMs + offsetMs,
  }));
}

function matchHeuristic(segment: AudioTranscriptSegment): CommentaryMarker | null {
  const text = segment.text.trim();
  if (!text) return null;
  const timeMs = segment.startMs;

  if (RACE_START_RE.test(text)) {
    return { kind: "race_start", timeMs, rawText: text, source: "heuristic" };
  }
  if (RACE_END_RE.test(text)) {
    return { kind: "race_end", timeMs, rawText: text, source: "heuristic" };
  }
  const lap = LAP_RE.exec(text);
  if (lap) {
    const lapNumber = Number.parseInt(lap[1] ?? "", 10);
    if (Number.isFinite(lapNumber) && lapNumber > 0) {
      return {
        kind: "lap",
        timeMs,
        rawText: text,
        source: "heuristic",
        lapNumber,
      };
    }
  }
  return null;
}

export function extractHeuristicMarkers(
  segments: AudioTranscriptSegment[],
): CommentaryMarker[] {
  const out: CommentaryMarker[] = [];
  for (const segment of segments) {
    const marker = matchHeuristic(segment);
    if (marker) out.push(marker);
  }
  return out;
}

export function segmentsWithoutHeuristicMatch(
  segments: AudioTranscriptSegment[],
): AudioTranscriptSegment[] {
  return segments.filter((segment) => matchHeuristic(segment) == null);
}

export function filterMarkersInDuration(
  markers: CommentaryMarker[],
  durationMs: number | null | undefined,
): CommentaryMarker[] {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0) {
    return markers.filter((m) => m.timeMs >= 0);
  }
  return markers.filter((m) => m.timeMs >= 0 && m.timeMs <= durationMs);
}

/**
 * Prefer heuristic markers when an LLM marker is the same kind within MERGE_NEAR_MS.
 */
export function mergeCommentaryMarkers(
  heuristic: CommentaryMarker[],
  llm: CommentaryMarker[],
): CommentaryMarker[] {
  const merged = [...heuristic];
  for (const candidate of llm) {
    const conflict = merged.some(
      (existing) =>
        existing.kind === candidate.kind &&
        Math.abs(existing.timeMs - candidate.timeMs) <= MERGE_NEAR_MS,
    );
    if (!conflict) merged.push({ ...candidate, source: "llm" });
  }
  return merged.sort((a, b) => a.timeMs - b.timeMs);
}

export function firstRaceStartMs(
  markers: CommentaryMarker[],
): number | null {
  const starts = markers
    .filter((m) => m.kind === "race_start")
    .map((m) => m.timeMs)
    .sort((a, b) => a - b);
  return starts[0] ?? null;
}

export function lapMarkerWindows(
  markers: CommentaryMarker[],
): Array<{ startMs: number; endMs: number }> {
  return markers
    .filter((m) => m.kind === "lap")
    .map((m) => ({
      startMs: Math.max(0, m.timeMs - 2_000),
      endMs: m.timeMs + 10_000,
    }));
}

export function boostScoreNearLapMarkers(
  score: number,
  startMs: number,
  endMs: number,
  markers: CommentaryMarker[],
): number {
  const mid = (startMs + endMs) / 2;
  const near = markers.some(
    (m) => m.kind === "lap" && Math.abs(m.timeMs - mid) <= MARKER_NEAR_MS,
  );
  return near ? Math.min(1, score + LAP_MARKER_SCORE_BOOST) : score;
}

/**
 * Soft-demote Shorts whose midpoint (or majority of duration) sits before race start.
 */
export function demoteScoreBeforeRaceStart(
  score: number,
  startMs: number,
  endMs: number,
  raceStartMs: number | null,
): number {
  if (raceStartMs == null) return score;
  const duration = Math.max(0, endMs - startMs);
  if (duration <= 0) return score;
  const preMs = Math.max(0, Math.min(endMs, raceStartMs) - startMs);
  const mid = (startMs + endMs) / 2;
  const mostlyPre = mid < raceStartMs || preMs / duration >= 0.5;
  if (!mostlyPre) return score;
  return Math.max(0, score - PRE_RACE_SCORE_PENALTY);
}

function formatMsClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatCommentaryMarkersForPrompt(
  markers: CommentaryMarker[],
): string {
  if (!markers.length) {
    return "(nessun marker parlato riconosciuto)";
  }
  return markers
    .map((m) => {
      const lap =
        m.kind === "lap" && m.lapNumber != null ? ` lap=${m.lapNumber}` : "";
      return `- [${formatMsClock(m.timeMs)}] ${m.kind}${lap} (${m.source}): "${m.rawText}"`;
    })
    .join("\n");
}

export function formatTranscriptSegmentsForPrompt(
  segments: AudioTranscriptSegment[],
): string {
  if (!segments.length) return "(nessun parlato rilevato)";
  return segments
    .map(
      (s) =>
        `[${formatMsClock(s.startMs)}-${formatMsClock(s.endMs)}] ${s.text}`,
    )
    .join("\n");
}
