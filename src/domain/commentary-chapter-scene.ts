import type { CommentaryTimelineChapter } from "./commentary-timeline-segments";
import { timelineSummariesForWindow } from "./commentary-timeline-segments";
import type { RaceAnalysis, RaceAnalysisEvent } from "./race-analysis";
import type { RaceHudSnapshot } from "./race-hud";

export type CompactHudSnapshot = {
  timeMs: number;
  lap: number | null;
  sessionStatus: string | null;
  flag: string | null;
  focusPosition: number | null;
  focusCarNumber: number | null;
  focusDriver: string | null;
  gapToLeader: string | null;
  deltaBest: string | null;
  battleCallout: string | null;
  nearbyCars: string[];
};

export type CommentaryChapterScene = {
  timelineBeats: string[];
  events: RaceAnalysisEvent[];
  hudSnapshots: CompactHudSnapshot[];
  transcriptCues: string[];
  markerCues: string[];
  sceneDensity: "rich" | "moderate" | "sparse";
};

function overlapsWindow(
  startMs: number,
  endMs: number,
  windowStart: number,
  windowEnd: number,
): boolean {
  return endMs >= windowStart && startMs <= windowEnd;
}

function compactHudSnapshot(snap: RaceHudSnapshot): CompactHudSnapshot {
  const nearby = (snap.battle?.rows ?? [])
    .slice(0, 4)
    .map((row) => {
      const name = row.driverName ?? (row.carNumber != null ? `#${row.carNumber}` : "?");
      const gap =
        row.gapSec != null
          ? `${row.gapSec >= 0 ? "+" : ""}${row.gapSec.toFixed(2)}s`
          : "";
      return `${row.role}:${name}${gap ? ` ${gap}` : ""}`;
    })
    .filter((line) => line.length > 0);

  const callout = snap.battleCallout
    ? [
        snap.battleCallout.contestedPosition != null
          ? `P${snap.battleCallout.contestedPosition}`
          : null,
        ...snap.battleCallout.rows.map((row) => {
          const name = row.driverName ?? (row.carNumber != null ? `#${row.carNumber}` : "?");
          const gap =
            row.gapSec != null ? `${row.gapSec.toFixed(2)}s` : row.note ?? "";
          return `${name}${gap ? ` ${gap}` : ""}`;
        }),
      ]
        .filter((part): part is string => Boolean(part))
        .join(" vs ")
    : null;

  return {
    timeMs: snap.timeMs,
    lap: snap.session?.lap ?? null,
    sessionStatus: snap.session?.status ?? null,
    flag: snap.session?.flag ?? null,
    focusPosition: snap.focus?.position ?? null,
    focusCarNumber: snap.focus?.carNumber ?? null,
    focusDriver: snap.focus?.driverName ?? null,
    gapToLeader: snap.focus?.gapToLeader ?? null,
    deltaBest: snap.focus?.deltaBest ?? null,
    battleCallout: callout,
    nearbyCars: nearby,
  };
}

function sampleHudSnapshots(
  snapshots: RaceHudSnapshot[],
  maxCount: number,
): RaceHudSnapshot[] {
  if (snapshots.length <= maxCount) return snapshots;
  const step = Math.max(1, Math.floor(snapshots.length / maxCount));
  const sampled: RaceHudSnapshot[] = [];
  for (let index = 0; index < snapshots.length && sampled.length < maxCount; index += step) {
    sampled.push(snapshots[index]!);
  }
  const last = snapshots.at(-1);
  if (last && sampled.at(-1)?.timeMs !== last.timeMs) {
    sampled[sampled.length - 1] = last;
  }
  return sampled;
}

export function buildCommentaryChapterScene(
  analysis: RaceAnalysis,
  chapter: CommentaryTimelineChapter,
): CommentaryChapterScene {
  const { startMs, endMs } = chapter;
  const timelineBeats = [
    ...new Set([
      ...chapter.summaries.filter(
        (summary) => !/^Race segment \d+\/\d+$/i.test(summary.trim()),
      ),
      ...timelineSummariesForWindow(analysis, startMs, endMs),
    ]),
  ];

  const events = analysis.events.filter((event) =>
    overlapsWindow(event.startMs, event.endMs, startMs, endMs),
  );

  const hudInWindow = (analysis.hudTimeline ?? []).filter(
    (snap) => snap.timeMs >= startMs && snap.timeMs <= endMs,
  );
  const hudSnapshots = sampleHudSnapshots(hudInWindow, 5).map(compactHudSnapshot);

  const transcriptCues = (analysis.audioTranscriptSegments ?? [])
    .filter((segment) =>
      overlapsWindow(segment.startMs, segment.endMs, startMs, endMs),
    )
    .map((segment) => segment.text.trim())
    .filter((text) => text.length > 0)
    .slice(0, 8);

  const markerCues = (analysis.commentaryMarkers ?? [])
    .filter((marker) => marker.timeMs >= startMs && marker.timeMs <= endMs)
    .map((marker) =>
      marker.lapNumber != null
        ? `lap ${marker.lapNumber}: ${marker.rawText}`
        : `${marker.kind}: ${marker.rawText}`,
    )
    .slice(0, 6);

  const factCount =
    timelineBeats.length +
    events.length +
    hudSnapshots.length +
    transcriptCues.length +
    markerCues.length;
  const sceneDensity =
    factCount >= 6 ? "rich" : factCount >= 2 ? "moderate" : "sparse";

  return {
    timelineBeats,
    events,
    hudSnapshots,
    transcriptCues,
    markerCues,
    sceneDensity,
  };
}

export const PLAY_BY_PLAY_COMMENTARY_RULES = `
Live play-by-play (mandatory):
- You are calling the TV pictures for THIS segment only — describe what the viewer sees on screen NOW.
- Anchor every line to sceneFacts for that chapter: events, hudSnapshots, timelineBeats, transcriptCues, markerCues.
- Name positions, gaps, rivals, corners, and on-track action when the data supplies them.
- Do NOT retell the full race story, generic motivation, or editorial mainStoryline unless it matches an event in this window.
- Do NOT invent overtakes, contacts, or positions absent from sceneFacts or raceContext verified facts.
- When sceneDensity is sparse: one or two crisp lines (track position, lap, gap) then stop — shorter than targetWordsMax is correct.
- Generic color commentary only when sceneFacts are truly empty; never pad with filler.
`.trim();
