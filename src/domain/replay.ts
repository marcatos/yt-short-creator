import type {
  ReplayEvent,
  ReplayProvenance,
  ReplaySession,
  ShortCandidate,
} from "./entities";

export function defaultTitleFromRpyPath(rpyPath: string): string {
  const base =
    rpyPath.replace(/\\/g, "/").split("/").pop() ?? "iRacing replay";
  return base.replace(/\.rpy$/i, "") || "iRacing replay";
}

export function defaultTitleFromMediaPath(mediaPath: string): string {
  const base =
    mediaPath.replace(/\\/g, "/").split("/").pop() ?? "Race capture";
  return base.replace(/\.[^.]+$/i, "") || "Race capture";
}

export function isReplayProvenance(
  provenance: ShortCandidate["provenance"],
): provenance is ReplayProvenance {
  return "replaySessionId" in provenance;
}

export function isClipProvenance(
  provenance: ShortCandidate["provenance"],
): provenance is import("./entities").ClipProvenance {
  return "sourceVideoId" in provenance;
}

export function isGenerateProvenance(
  provenance: ShortCandidate["provenance"],
): provenance is import("./entities").GenerateProvenance {
  return "generationBriefId" in provenance;
}

/** Prefer telemetry-backed moments when enough strong events exist. */
export const TELEMETRY_EVENT_THRESHOLD = 1;
export const TELEMETRY_MIN_SCORE = 0.45;

export function selectTelemetryEvents(events: ReplayEvent[]): ReplayEvent[] {
  return events.filter(
    (event) =>
      event.type !== "manual" &&
      event.type !== "llm_moment" &&
      event.score >= TELEMETRY_MIN_SCORE,
  );
}

export function shouldPreferTelemetry(events: ReplayEvent[]): boolean {
  return selectTelemetryEvents(events).length >= TELEMETRY_EVENT_THRESHOLD;
}

const MIN_WINDOW_MS = 8_000;
const MAX_WINDOW_MS = 60_000;
const PAD_BEFORE_MS = 3_000;
const PAD_AFTER_MS = 8_000;

export function windowAroundEvent(
  event: Pick<ReplayEvent, "startMs" | "endMs">,
  durationSec: number | null,
): { startMs: number; endMs: number } {
  const maxEndMs =
    durationSec !== null && durationSec > 0
      ? durationSec * 1_000
      : Number.POSITIVE_INFINITY;
  let startMs = Math.max(0, event.startMs - PAD_BEFORE_MS);
  let endMs = Math.min(maxEndMs, Math.max(event.endMs, event.startMs) + PAD_AFTER_MS);
  let durationMs = endMs - startMs;

  if (durationMs < MIN_WINDOW_MS) {
    endMs = Math.min(maxEndMs, startMs + MIN_WINDOW_MS);
    durationMs = endMs - startMs;
    if (durationMs < MIN_WINDOW_MS) {
      startMs = Math.max(0, endMs - MIN_WINDOW_MS);
    }
  }

  if (endMs - startMs > MAX_WINDOW_MS) {
    endMs = startMs + MAX_WINDOW_MS;
  }

  return { startMs: Math.floor(startMs), endMs: Math.floor(endMs) };
}

export function sessionSourceHint(session: ReplaySession): string {
  const track = session.trackName ? ` @ ${session.trackName}` : "";
  return `${session.title}${track}`;
}
