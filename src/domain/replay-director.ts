import type { ReplayEvent, ReplayEventType } from "./entities";
import { selectTelemetryEvents, windowAroundEvent } from "./replay";

export type DirectorShot = {
  id: string;
  eventType: ReplayEventType;
  /** Replay session time to seek before recording. */
  seekMs: number;
  /** Wall-clock record length at 1x play speed. */
  recordMs: number;
  /** 1-based race position for CamSwitchPos (fallback when car number unknown). */
  carPosition: number;
  cameraGroup: number;
  cameraNumber: number;
  title: string;
  hookReason: string;
  score: number;
};

export type BuildDirectorShotPlanInput = {
  events: ReplayEvent[];
  focusCarPosition?: number | null;
  maxShots?: number;
  anticipationMs?: number;
  durationSec?: number | null;
};

const DEFAULT_MAX_SHOTS = 8;
const DEFAULT_ANTICIPATION_MS = 3_000;
const MIN_RECORD_MS = 8_000;
const MAX_RECORD_MS = 45_000;

/**
 * Builds an event-driven camera plan (ReplayDirector / Sequence Director style):
 * anticipate each highlight, switch to a car, record a short window.
 */
export function buildDirectorShotPlan(
  input: BuildDirectorShotPlanInput,
): DirectorShot[] {
  const maxShots = input.maxShots ?? DEFAULT_MAX_SHOTS;
  const anticipationMs = input.anticipationMs ?? DEFAULT_ANTICIPATION_MS;
  const focusCarPosition = Math.max(
    1,
    Math.trunc(input.focusCarPosition ?? 1) || 1,
  );
  const selected = selectTelemetryEvents(input.events)
    .slice()
    .sort((a, b) => b.score - a.score || a.startMs - b.startMs)
    .slice(0, maxShots)
    .sort((a, b) => a.startMs - b.startMs);

  return selected.map((event, index) => {
    const window = windowAroundEvent(event, input.durationSec ?? null);
    const seekMs = Math.max(0, window.startMs - anticipationMs);
    const rawRecord = window.endMs - seekMs;
    const recordMs = Math.min(
      MAX_RECORD_MS,
      Math.max(MIN_RECORD_MS, rawRecord),
    );
    const carFromPayload =
      typeof event.payload?.carPosition === "number"
        ? Math.max(1, Math.trunc(event.payload.carPosition))
        : focusCarPosition;

    return {
      id: event.id || `shot-${index + 1}`,
      eventType: event.type,
      seekMs,
      recordMs,
      carPosition: carFromPayload,
      cameraGroup: 1,
      cameraNumber: 1,
      title: event.title ?? `${event.type.replace(/_/g, " ")} highlight`,
      hookReason: event.hookReason,
      score: event.score,
    };
  });
}

/** Fallback plan when telemetry is empty: hunt incidents via replay search. */
export function buildIncidentHuntPlan(input: {
  shotCount?: number;
  recordMs?: number;
  focusCarPosition?: number | null;
}): DirectorShot[] {
  const count = input.shotCount ?? 5;
  const recordMs = Math.min(
    MAX_RECORD_MS,
    Math.max(MIN_RECORD_MS, input.recordMs ?? 12_000),
  );
  const carPosition = Math.max(1, Math.trunc(input.focusCarPosition ?? 1) || 1);

  return Array.from({ length: count }, (_, index) => ({
    id: `incident-hunt-${index + 1}`,
    eventType: "incident" as const,
    seekMs: -1, // signal: use ReplaySearch NextIncident
    recordMs,
    carPosition,
    cameraGroup: 1,
    cameraNumber: 1,
    title: `Incident hunt #${index + 1}`,
    hookReason: "Auto director jumped to next incident",
    score: 0.6,
  }));
}

export type DirectorTimelineEntry = {
  shot: DirectorShot;
  startMs: number;
  endMs: number;
};

/** Map recorded segment durations onto a concatenated highlight timeline. */
export function buildConcatTimeline(
  shots: DirectorShot[],
  segmentDurationsMs: number[],
): DirectorTimelineEntry[] {
  let cursor = 0;
  return shots.map((shot, index) => {
    const durationMs = Math.max(
      MIN_RECORD_MS,
      segmentDurationsMs[index] ?? shot.recordMs,
    );
    const startMs = cursor;
    const endMs = cursor + durationMs;
    cursor = endMs;
    return { shot, startMs, endMs };
  });
}
