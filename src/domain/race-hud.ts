import { z } from "zod";

/**
 * Structured race HUD overlays burned into OBS / replay captures
 * (session strip, focus card, battle/relative, standings, battle callout, field ticker).
 */

export const BATTLE_GAP_THRESHOLD_SEC = 1.0;
export const HUD_BATTLE_SCORE_BOOST = 0.08;
/** Extra boost when the explicit "Battle for Px" callout is near a Short window. */
export const HUD_CALLOUT_SCORE_BOOST = 0.12;

export type SessionStripState = {
  sessionType: string | null;
  status: string | null;
  trackName: string | null;
  lap: number | null;
  sessionTime: string | null;
  flag: string | null;
};

export type FocusSectorTimes = {
  s1: string | null;
  s2: string | null;
  s3: string | null;
};

export type FocusCardState = {
  carNumber: number | null;
  driverName: string | null;
  position: number | null;
  fieldSize: number | null;
  lastLap: string | null;
  bestLap: string | null;
  gapToLeader: string | null;
  /** Delta to personal best (e.g. "-0.71s" / "+0.23s") as shown on FOCUS. */
  deltaBest: string | null;
  /** Fuel percent text or null when blank/unreadable. */
  fuelPct: string | null;
  sectors: FocusSectorTimes | null;
};

export type BattleRelativeRole = "ahead" | "focus" | "behind";

export type BattleRelativeRow = {
  role: BattleRelativeRole;
  carNumber: number | null;
  driverName: string | null;
  gapSec: number | null;
};

export type BattleRelativeState = {
  rows: BattleRelativeRow[];
};

export type StandingsRow = {
  position: number;
  carNumber: number | null;
  driverName: string | null;
  gapText: string | null;
  /** Positions gained (+) / lost (-) from standings arrows; null if absent. */
  positionDelta: number | null;
};

export type StandingsState = {
  rows: StandingsRow[];
};

export type BattleCalloutRow = {
  carNumber: number | null;
  driverName: string | null;
  gapSec: number | null;
  /** Extra label on the callout (e.g. "SIDE"). */
  note: string | null;
};

export type BattleCalloutState = {
  /** Contested place, e.g. 2 for "Battle for P2". */
  contestedPosition: number | null;
  rows: BattleCalloutRow[];
};

export type FieldTickerRow = {
  position: number | null;
  carNumber: number | null;
  driverName: string | null;
  gapText: string | null;
};

export type FieldTickerState = {
  rows: FieldTickerRow[];
};

export type RaceHudSnapshot = {
  timeMs: number;
  session: SessionStripState | null;
  focus: FocusCardState | null;
  battle: BattleRelativeState | null;
  standings: StandingsState | null;
  battleCallout: BattleCalloutState | null;
  fieldTicker: FieldTickerState | null;
  confidence: "verified" | "inferred" | "unknown";
};

export type RaceHudTimeline = RaceHudSnapshot[];

export type FocusSubject = {
  carNumber: number | null;
  driverName: string | null;
  /** Human hint for vision / FASE A prompts. */
  hint: string;
};

const nullableString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().min(1).nullable(),
);
const nullablePositiveInt = z.preprocess(
  (value) => (value === "" ? null : value),
  z.number().int().positive().nullable(),
);
const nullableNumber = z.preprocess(
  (value) => (value === "" ? null : value),
  z.number().nullable(),
);

export const sessionStripStateSchema = z.object({
  sessionType: nullableString,
  status: nullableString,
  trackName: nullableString,
  /** Lap counters may show 0 before the first completed lap. */
  lap: z.preprocess(
    (value) => (value === "" ? null : value),
    z.number().int().nonnegative().nullable(),
  ),
  sessionTime: nullableString,
  flag: nullableString,
});

export const focusSectorTimesSchema = z.object({
  s1: nullableString,
  s2: nullableString,
  s3: nullableString,
});

export const focusCardStateSchema = z.object({
  carNumber: nullablePositiveInt,
  driverName: nullableString,
  position: nullablePositiveInt,
  fieldSize: nullablePositiveInt,
  lastLap: nullableString,
  bestLap: nullableString,
  gapToLeader: nullableString,
  deltaBest: nullableString.default(null),
  fuelPct: nullableString.default(null),
  sectors: focusSectorTimesSchema.nullable().default(null),
});

export const battleRelativeRowSchema = z.object({
  role: z.enum(["ahead", "focus", "behind"]),
  carNumber: nullablePositiveInt,
  driverName: nullableString,
  gapSec: nullableNumber,
});

export const battleRelativeStateSchema = z.object({
  rows: z.array(battleRelativeRowSchema).max(12),
});

export const standingsRowSchema = z.object({
  position: z.number().int().positive(),
  carNumber: nullablePositiveInt,
  driverName: nullableString,
  gapText: nullableString,
  positionDelta: nullableNumber.default(null),
});

export const standingsStateSchema = z.object({
  rows: z.array(standingsRowSchema).max(40),
});

export const battleCalloutRowSchema = z.object({
  carNumber: nullablePositiveInt,
  driverName: nullableString,
  gapSec: nullableNumber,
  note: nullableString,
});

export const battleCalloutStateSchema = z.object({
  contestedPosition: nullablePositiveInt,
  rows: z.array(battleCalloutRowSchema).max(6),
});

export const fieldTickerRowSchema = z.object({
  position: z.preprocess(
    (value) => (value === "" ? null : value),
    z.number().int().positive().nullable(),
  ),
  carNumber: nullablePositiveInt,
  driverName: nullableString,
  gapText: nullableString,
});

export const fieldTickerStateSchema = z.object({
  rows: z.array(fieldTickerRowSchema).max(15),
});

export const raceHudSnapshotSchema = z.object({
  timeMs: z.number().int().nonnegative(),
  session: sessionStripStateSchema.nullable(),
  focus: focusCardStateSchema.nullable(),
  battle: battleRelativeStateSchema.nullable(),
  standings: standingsStateSchema.nullable(),
  battleCallout: battleCalloutStateSchema.nullable().default(null),
  fieldTicker: fieldTickerStateSchema.nullable().default(null),
  confidence: z.enum(["verified", "inferred", "unknown"]),
});

export const raceHudTimelineSchema = z.array(raceHudSnapshotSchema).max(500);

function emptySession(): SessionStripState {
  return {
    sessionType: null,
    status: null,
    trackName: null,
    lap: null,
    sessionTime: null,
    flag: null,
  };
}

function emptyFocus(): FocusCardState {
  return {
    carNumber: null,
    driverName: null,
    position: null,
    fieldSize: null,
    lastLap: null,
    bestLap: null,
    gapToLeader: null,
    deltaBest: null,
    fuelPct: null,
    sectors: null,
  };
}

export function formatFocusSubjectHint(subject: FocusSubject): string {
  const parts: string[] = [];
  if (subject.carNumber != null) parts.push(`#${subject.carNumber}`);
  if (subject.driverName) parts.push(subject.driverName);
  if (parts.length === 0) return subject.hint;
  return `${parts.join(" ")} (camera focus from HUD)`;
}

/**
 * Majority vote on Focus card car number + name across the timeline.
 */
export function resolveFocusSubject(
  timeline: RaceHudTimeline,
  fallbackHint: string,
): FocusSubject {
  const carCounts = new Map<number, number>();
  const nameCounts = new Map<string, number>();

  for (const snap of timeline) {
    const focus = snap.focus;
    if (!focus) continue;
    if (focus.carNumber != null) {
      carCounts.set(focus.carNumber, (carCounts.get(focus.carNumber) ?? 0) + 1);
    }
    if (focus.driverName) {
      const key = focus.driverName.trim();
      if (key) nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
  }

  const carNumber = pickMajority(carCounts);
  const driverName = pickMajority(nameCounts);
  const subject: FocusSubject = {
    carNumber,
    driverName,
    hint: fallbackHint,
  };
  subject.hint = formatFocusSubjectHint({
    carNumber,
    driverName,
    hint: fallbackHint,
  });
  if (carNumber == null && !driverName) {
    subject.hint = fallbackHint;
  }
  return subject;
}

function pickMajority<T>(counts: Map<T, number>): T | null {
  let best: T | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

export function sliceHudWindow(
  timeline: RaceHudTimeline,
  startMs: number,
  endMs: number,
): RaceHudTimeline {
  if (endMs < startMs) return [];
  return timeline.filter(
    (snap) => snap.timeMs >= startMs && snap.timeMs <= endMs,
  );
}

function focusPositionAt(
  snap: RaceHudSnapshot,
  focusCarNumber: number | null,
): { position: number; fieldSize: number | null } | null {
  if (snap.focus?.position != null) {
    const carOk =
      focusCarNumber == null ||
      snap.focus.carNumber == null ||
      snap.focus.carNumber === focusCarNumber;
    if (carOk) {
      return {
        position: snap.focus.position,
        fieldSize: snap.focus.fieldSize,
      };
    }
  }
  if (focusCarNumber != null && snap.standings?.rows.length) {
    const row = snap.standings.rows.find(
      (entry) => entry.carNumber === focusCarNumber,
    );
    if (row) {
      return {
        position: row.position,
        fieldSize: snap.focus?.fieldSize ?? snap.standings.rows.length,
      };
    }
  }
  return null;
}

/**
 * Infer start/finish/fieldSize from first/last readable HUD positions for the
 * focus car. Only fills fields that are still null in `base`.
 */
export function inferResultsFromHud(
  timeline: RaceHudTimeline,
  focusCarNumber: number | null,
  base: {
    qualiResult: string | null;
    startPosition: number | null;
    finishPosition: number | null;
    fieldSize: number | null;
    positionsGained: number | null;
  } = {
    qualiResult: null,
    startPosition: null,
    finishPosition: null,
    fieldSize: null,
    positionsGained: null,
  },
): {
  qualiResult: string | null;
  startPosition: number | null;
  finishPosition: number | null;
  fieldSize: number | null;
  positionsGained: number | null;
} {
  const ordered = [...timeline].sort((a, b) => a.timeMs - b.timeMs);
  let first: { position: number; fieldSize: number | null } | null = null;
  let last: { position: number; fieldSize: number | null } | null = null;
  let fieldSize: number | null = null;

  for (const snap of ordered) {
    const pos = focusPositionAt(snap, focusCarNumber);
    if (!pos) continue;
    if (!first) first = pos;
    last = pos;
    if (pos.fieldSize != null) fieldSize = pos.fieldSize;
    if (snap.focus?.fieldSize != null) fieldSize = snap.focus.fieldSize;
  }

  const startPosition = base.startPosition ?? first?.position ?? null;
  const finishPosition = base.finishPosition ?? last?.position ?? null;
  const resolvedField =
    base.fieldSize ?? fieldSize ?? first?.fieldSize ?? last?.fieldSize ?? null;
  const positionsGained =
    base.positionsGained ??
    (startPosition != null && finishPosition != null
      ? startPosition - finishPosition
      : null);

  return {
    qualiResult: base.qualiResult,
    startPosition,
    finishPosition,
    fieldSize: resolvedField,
    positionsGained,
  };
}

export type HudBattleWindow = {
  startMs: number;
  endMs: number;
  summary: string;
  minGapSec: number;
};

function minAbsBattleGap(battle: BattleRelativeState | null): number | null {
  if (!battle?.rows.length) return null;
  let min: number | null = null;
  for (const row of battle.rows) {
    if (row.role === "focus") continue;
    if (row.gapSec == null || !Number.isFinite(row.gapSec)) continue;
    const abs = Math.abs(row.gapSec);
    if (min == null || abs < min) min = abs;
  }
  return min;
}

/**
 * Merge contiguous snapshots where an ahead/behind gap is within threshold.
 */
export function detectBattleWindows(
  timeline: RaceHudTimeline,
  thresholdSec: number = BATTLE_GAP_THRESHOLD_SEC,
): HudBattleWindow[] {
  const ordered = [...timeline].sort((a, b) => a.timeMs - b.timeMs);
  const windows: HudBattleWindow[] = [];
  let open: HudBattleWindow | null = null;

  for (const snap of ordered) {
    const gap = minAbsBattleGap(snap.battle);
    const inBattle = gap != null && gap <= thresholdSec;
    if (inBattle && gap != null) {
      if (!open) {
        open = {
          startMs: snap.timeMs,
          endMs: snap.timeMs,
          summary: `Close battle (gap ${gap.toFixed(2)}s)`,
          minGapSec: gap,
        };
      } else {
        open.endMs = snap.timeMs;
        open.minGapSec = Math.min(open.minGapSec, gap);
        open.summary = `Close battle (gap ${open.minGapSec.toFixed(2)}s)`;
      }
    } else if (open) {
      windows.push(open);
      open = null;
    }
  }
  if (open) windows.push(open);

  return windows.map((window) => ({
    ...window,
    endMs: Math.max(window.endMs, window.startMs + 1_000),
  }));
}

export function battleWindowsToEvents(windows: HudBattleWindow[]): Array<{
  kind: "battle";
  startMs: number;
  endMs: number;
  summary: string;
  involvingFocusCar: boolean;
  confidence: "verified";
}> {
  return windows.map((window) => ({
    kind: "battle" as const,
    startMs: window.startMs,
    endMs: window.endMs,
    summary: window.summary,
    involvingFocusCar: true,
    confidence: "verified" as const,
  }));
}

function formatCalloutSummary(callout: BattleCalloutState): string {
  const pos =
    callout.contestedPosition != null
      ? `P${callout.contestedPosition}`
      : "position";
  const cars = callout.rows
    .map((row) => {
      const id =
        row.carNumber != null
          ? `#${row.carNumber}`
          : row.driverName
            ? row.driverName
            : null;
      if (!id) return null;
      const gap =
        row.gapSec != null && Number.isFinite(row.gapSec)
          ? ` ${row.gapSec.toFixed(2)}s`
          : "";
      const note = row.note ? ` (${row.note})` : "";
      return `${id}${gap}${note}`;
    })
    .filter(Boolean);
  if (!cars.length) return `Battle for ${pos}`;
  return `Battle for ${pos}: ${cars.join(" vs ")}`;
}

/**
 * Contiguous snapshots where the bottom-center "Battle for Px" callout is visible.
 */
export function detectCalloutWindows(
  timeline: RaceHudTimeline,
): HudBattleWindow[] {
  const ordered = [...timeline].sort((a, b) => a.timeMs - b.timeMs);
  const windows: HudBattleWindow[] = [];
  let open: HudBattleWindow | null = null;

  for (const snap of ordered) {
    const callout = snap.battleCallout;
    const active =
      callout != null &&
      (callout.contestedPosition != null || callout.rows.length > 0);
    if (active && callout) {
      const summary = formatCalloutSummary(callout);
      const gaps = callout.rows
        .map((row) => row.gapSec)
        .filter((gap): gap is number => gap != null && Number.isFinite(gap))
        .map((gap) => Math.abs(gap));
      const minGap = gaps.length ? Math.min(...gaps) : 0;
      if (!open) {
        open = {
          startMs: snap.timeMs,
          endMs: snap.timeMs,
          summary,
          minGapSec: minGap,
        };
      } else {
        open.endMs = snap.timeMs;
        open.minGapSec = Math.min(open.minGapSec, minGap);
        open.summary = summary;
      }
    } else if (open) {
      windows.push(open);
      open = null;
    }
  }
  if (open) windows.push(open);

  return windows.map((window) => ({
    ...window,
    endMs: Math.max(window.endMs, window.startMs + 1_000),
  }));
}

function parseGapSeconds(text: string | null | undefined): number | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed || /^leader$/i.test(trimmed)) return 0;
  const match = trimmed.match(/([+-]?\d+(?:\.\d+)?)\s*s?/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Cross-check FOCUS vs STANDINGS; downgrade confidence when panels disagree.
 * Prefers standings row for the focus car number when positions conflict.
 */
export function reconcileHudSnapshot(snap: RaceHudSnapshot): RaceHudSnapshot {
  const focus = snap.focus;
  const standings = snap.standings;
  if (!focus || focus.carNumber == null || !standings?.rows.length) {
    return snap;
  }

  const standingRow = standings.rows.find(
    (row) => row.carNumber === focus.carNumber,
  );
  if (!standingRow) return snap;

  let conflict = false;
  let nextFocus = focus;

  if (
    focus.position != null &&
    standingRow.position !== focus.position
  ) {
    conflict = true;
    nextFocus = { ...nextFocus, position: standingRow.position };
  }

  const focusGap = parseGapSeconds(focus.gapToLeader);
  const standingsGap = parseGapSeconds(standingRow.gapText);
  if (
    focusGap != null &&
    standingsGap != null &&
    Math.abs(focusGap - standingsGap) > 0.35
  ) {
    conflict = true;
    nextFocus = {
      ...nextFocus,
      gapToLeader: standingRow.gapText ?? nextFocus.gapToLeader,
    };
  }

  if (!conflict) return snap;

  const confidence =
    snap.confidence === "unknown" ? "unknown" : "inferred";
  return {
    ...snap,
    focus: nextFocus,
    confidence,
  };
}

export function reconcileHudTimeline(
  timeline: RaceHudTimeline,
): RaceHudTimeline {
  return timeline.map(reconcileHudSnapshot);
}

export function collectRecurringRivals(
  timeline: RaceHudTimeline,
  focusCarNumber: number | null,
  limit = 8,
): string[] {
  const counts = new Map<string, number>();

  for (const snap of timeline) {
    const consider = (carNumber: number | null, driverName: string | null) => {
      if (focusCarNumber != null && carNumber === focusCarNumber) return;
      const label =
        carNumber != null && driverName
          ? `#${carNumber} ${driverName}`
          : driverName
            ? driverName
            : carNumber != null
              ? `#${carNumber}`
              : null;
      if (!label) return;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    };

    for (const row of snap.battle?.rows ?? []) {
      if (row.role === "focus") continue;
      consider(row.carNumber, row.driverName);
    }
    for (const row of snap.standings?.rows ?? []) {
      consider(row.carNumber, row.driverName);
    }
    for (const row of snap.battleCallout?.rows ?? []) {
      consider(row.carNumber, row.driverName);
    }
    for (const row of snap.fieldTicker?.rows ?? []) {
      consider(row.carNumber, row.driverName);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label]) => label);
}

/**
 * Downsample for FASE A prompts: keep first, last, and changes in focus
 * position / closest battle gap / session lap / battle callout presence.
 */
export function downsampleHudTimeline(
  timeline: RaceHudTimeline,
  maxSnapshots = 40,
): RaceHudTimeline {
  if (timeline.length <= maxSnapshots) {
    return [...timeline].sort((a, b) => a.timeMs - b.timeMs);
  }

  const ordered = [...timeline].sort((a, b) => a.timeMs - b.timeMs);
  const kept: RaceHudTimeline = [];
  let lastFocusPos: number | null = null;
  let lastLap: number | null = null;
  let lastGapBucket: number | null = null;
  let lastCalloutKey: string | null = null;

  for (let i = 0; i < ordered.length; i++) {
    const snap = ordered[i]!;
    const focusPos = snap.focus?.position ?? null;
    const lap = snap.session?.lap ?? null;
    const gap = minAbsBattleGap(snap.battle);
    const gapBucket =
      gap == null ? null : Math.floor(gap / 0.25); /* 0.25s buckets */
    const calloutKey =
      snap.battleCallout &&
      (snap.battleCallout.contestedPosition != null ||
        snap.battleCallout.rows.length > 0)
        ? `P${snap.battleCallout.contestedPosition ?? "?"}`
        : null;
    const isEdge = i === 0 || i === ordered.length - 1;
    const changed =
      focusPos !== lastFocusPos ||
      lap !== lastLap ||
      gapBucket !== lastGapBucket ||
      calloutKey !== lastCalloutKey;

    if (isEdge || changed) {
      kept.push(snap);
      lastFocusPos = focusPos;
      lastLap = lap;
      lastGapBucket = gapBucket;
      lastCalloutKey = calloutKey;
    }
  }

  if (kept.length <= maxSnapshots) return kept;

  const step = kept.length / maxSnapshots;
  const sampled: RaceHudTimeline = [];
  for (let i = 0; i < maxSnapshots; i++) {
    sampled.push(kept[Math.min(kept.length - 1, Math.floor(i * step))]!);
  }
  return sampled;
}

export function formatHudTimelineForPrompt(timeline: RaceHudTimeline): string {
  const sampled = downsampleHudTimeline(timeline);
  if (!sampled.length) return "(nessun HUD leggibile)";

  return sampled
    .map((snap) => {
      const parts: string[] = [`t=${snap.timeMs}ms`];
      if (snap.session) {
        const s = snap.session;
        parts.push(
          `session=${[s.status, s.trackName, s.lap != null ? `LAP ${s.lap}` : null, s.sessionTime, s.flag].filter(Boolean).join(" | ") || "—"}`,
        );
      }
      if (snap.focus) {
        const f = snap.focus;
        parts.push(
          `focus=#${f.carNumber ?? "?"} ${f.driverName ?? "?"} P${f.position ?? "?"}/${f.fieldSize ?? "?"} gap=${f.gapToLeader ?? "—"} last=${f.lastLap ?? "—"} best=${f.bestLap ?? "—"} Δbest=${f.deltaBest ?? "—"} fuel=${f.fuelPct ?? "—"}`,
        );
      }
      if (snap.battle?.rows.length) {
        const battle = snap.battle.rows
          .map(
            (row) =>
              `${row.role}:#${row.carNumber ?? "?"} ${row.driverName ?? "?"} ${row.gapSec ?? "—"}s`,
          )
          .join("; ");
        parts.push(`battle=[${battle}]`);
      }
      if (snap.standings?.rows.length) {
        const top = snap.standings.rows
          .slice(0, 10)
          .map((row) => {
            const delta =
              row.positionDelta != null
                ? ` Δ${row.positionDelta > 0 ? "+" : ""}${row.positionDelta}`
                : "";
            return `P${row.position}:#${row.carNumber ?? "?"} ${row.driverName ?? "?"} ${row.gapText ?? ""}${delta}`;
          })
          .join("; ");
        parts.push(`standings=[${top}]`);
      }
      if (
        snap.battleCallout &&
        (snap.battleCallout.contestedPosition != null ||
          snap.battleCallout.rows.length > 0)
      ) {
        parts.push(`callout=${formatCalloutSummary(snap.battleCallout)}`);
      }
      if (snap.fieldTicker?.rows.length) {
        const ticker = snap.fieldTicker.rows
          .slice(0, 10)
          .map(
            (row) =>
              `P${row.position ?? "?"}:#${row.carNumber ?? "?"} ${row.driverName ?? "?"} ${row.gapText ?? ""}`,
          )
          .join("; ");
        parts.push(`fieldTicker=[${ticker}]`);
      }
      if (snap.confidence !== "verified") {
        parts.push(`confidence=${snap.confidence}`);
      }
      return parts.join(" ");
    })
    .join("\n");
}

export function boostScoreNearHudBattles(
  score: number,
  startMs: number,
  endMs: number,
  windows: HudBattleWindow[],
): number {
  const mid = (startMs + endMs) / 2;
  const near = windows.some((window) => {
    const windowMid = (window.startMs + window.endMs) / 2;
    return Math.abs(windowMid - mid) <= 8_000;
  });
  return near ? Math.min(1, score + HUD_BATTLE_SCORE_BOOST) : score;
}

export function boostScoreNearHudCallouts(
  score: number,
  startMs: number,
  endMs: number,
  windows: HudBattleWindow[],
): number {
  const mid = (startMs + endMs) / 2;
  const near = windows.some((window) => {
    const windowMid = (window.startMs + window.endMs) / 2;
    return Math.abs(windowMid - mid) <= 8_000;
  });
  return near ? Math.min(1, score + HUD_CALLOUT_SCORE_BOOST) : score;
}

export function summarizeHudForNarration(
  timeline: RaceHudTimeline,
  focusCarNumber: number | null,
): Record<string, unknown> {
  if (!timeline.length) {
    return { snapshots: 0 };
  }
  const subject = resolveFocusSubject(timeline, "");
  const results = inferResultsFromHud(timeline, focusCarNumber ?? subject.carNumber);
  const ordered = [...timeline].sort((a, b) => a.timeMs - b.timeMs);
  const last = ordered.at(-1);
  const callouts = detectCalloutWindows(timeline);
  const lastCallout = [...ordered]
    .reverse()
    .find(
      (snap) =>
        snap.battleCallout &&
        (snap.battleCallout.contestedPosition != null ||
          snap.battleCallout.rows.length > 0),
    )?.battleCallout;
  return {
    snapshots: timeline.length,
    focus: {
      carNumber: subject.carNumber,
      driverName: subject.driverName,
    },
    results,
    lastFocus: last?.focus ?? null,
    lastBattle: last?.battle ?? null,
    lastSession: last?.session ?? null,
    lastBattleCallout: lastCallout ?? null,
    lastFieldTicker: last?.fieldTicker ?? null,
    calloutWindows: callouts.map((window) => ({
      startMs: window.startMs,
      endMs: window.endMs,
      summary: window.summary,
      minGapSec: window.minGapSec,
    })),
    rivals: collectRecurringRivals(
      timeline,
      focusCarNumber ?? subject.carNumber,
      5,
    ),
  };
}

export function emptyHudSnapshot(timeMs: number): RaceHudSnapshot {
  return {
    timeMs,
    session: emptySession(),
    focus: emptyFocus(),
    battle: { rows: [] },
    standings: { rows: [] },
    battleCallout: null,
    fieldTicker: null,
    confidence: "unknown",
  };
}
