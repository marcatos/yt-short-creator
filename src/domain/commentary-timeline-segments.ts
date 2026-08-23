import type { RaceAnalysis, RaceAnalysisEvent } from "./race-analysis";

/** ~145 wpm live commentary — used to size chapter scripts. */
export const COMMENTARY_WORDS_PER_SECOND = 2.4;

const MIN_CHAPTER_MS = 45_000;
const TARGET_CHAPTER_MS = 90_000;
const MIN_CHAPTERS = 4;
const MAX_CHAPTERS = 24;
const MIN_RACE_MS_FOR_CHAPTERED = 180_000;

export type CommentaryTimelineChapter = {
  label: string;
  startMs: number;
  endMs: number;
  summaries: string[];
  events: RaceAnalysisEvent[];
  targetWordsMin: number;
  targetWordsMax: number;
};

export function shouldUseTimelineChapteredScripts(
  analysis: RaceAnalysis,
  voiceOverMode: "driver" | "commentator",
): boolean {
  const durationMs = raceDurationMs(analysis);
  if (voiceOverMode === "commentator" && durationMs >= MIN_RACE_MS_FOR_CHAPTERED) {
    return true;
  }
  if (analysis.timeline.length >= 2) return true;
  if (durationMs >= 300_000) return true;
  return false;
}

export function buildCommentaryChaptersFromTimeline(
  analysis: RaceAnalysis,
): CommentaryTimelineChapter[] {
  const durationMs = raceDurationMs(analysis);
  if (durationMs <= 0) {
    throw new Error("Race duration is required for timeline chaptering");
  }

  const timeline = [...analysis.timeline].sort((a, b) => a.startMs - b.startMs);
  if (timeline.length === 0) {
    return splitEvenChapters(analysis, durationMs, estimateChapterCount(durationMs));
  }

  const targetCount = estimateChapterCount(durationMs);
  const targetChapterMs = Math.max(
    MIN_CHAPTER_MS,
    Math.ceil(durationMs / targetCount),
  );

  const buckets: Array<{
    startMs: number;
    endMs: number;
    summaries: string[];
  }> = [];

  for (const entry of timeline) {
    const last = buckets[buckets.length - 1];
    if (!last) {
      buckets.push({
        startMs: entry.startMs,
        endMs: entry.endMs,
        summaries: [entry.summary],
      });
      continue;
    }
    const wouldSpan = entry.endMs - last.startMs;
    if (wouldSpan < targetChapterMs && buckets.length < targetCount) {
      last.endMs = Math.max(last.endMs, entry.endMs);
      last.summaries.push(entry.summary);
    } else {
      buckets.push({
        startMs: entry.startMs,
        endMs: entry.endMs,
        summaries: [entry.summary],
      });
    }
  }

  if (
    buckets.length < targetCount &&
    durationMs >= MIN_RACE_MS_FOR_CHAPTERED
  ) {
    return splitEvenChapters(analysis, durationMs, targetCount);
  }

  if (buckets.length === 1 && durationMs >= MIN_RACE_MS_FOR_CHAPTERED) {
    return splitEvenChapters(analysis, durationMs, targetCount);
  }

  return buckets.map((bucket, index) =>
    finalizeChapter(analysis, bucket, index, durationMs),
  );
}

function raceDurationMs(analysis: RaceAnalysis): number {
  const fromContext = analysis.context.durationSec;
  if (fromContext != null && fromContext > 0) {
    return Math.round(fromContext * 1_000);
  }
  const lastTimeline = analysis.timeline.at(-1);
  if (lastTimeline) return lastTimeline.endMs;
  return 0;
}

function estimateChapterCount(durationMs: number): number {
  return Math.min(
    MAX_CHAPTERS,
    Math.max(MIN_CHAPTERS, Math.ceil(durationMs / TARGET_CHAPTER_MS)),
  );
}

function splitEvenChapters(
  analysis: RaceAnalysis,
  durationMs: number,
  chapterCount: number,
): CommentaryTimelineChapter[] {
  const sliceMs = Math.ceil(durationMs / chapterCount);
  const chapters: CommentaryTimelineChapter[] = [];
  for (let index = 0; index < chapterCount; index += 1) {
    const startMs = index * sliceMs;
    const endMs = Math.min(durationMs, startMs + sliceMs);
    const windowSummaries = timelineSummariesForWindow(analysis, startMs, endMs);
    chapters.push(
      finalizeChapter(
        analysis,
        {
          startMs,
          endMs,
          summaries:
            windowSummaries.length > 0
              ? windowSummaries
              : [`Race segment ${index + 1}/${chapterCount}`],
        },
        index,
        durationMs,
      ),
    );
  }
  return chapters;
}

function finalizeChapter(
  analysis: RaceAnalysis,
  bucket: { startMs: number; endMs: number; summaries: string[] },
  index: number,
  raceDurationMs: number,
): CommentaryTimelineChapter {
  const durationMs = Math.max(1, bucket.endMs - bucket.startMs);
  const durationSec = durationMs / 1_000;
  const targetWordsMin = Math.max(
    25,
    Math.floor(durationSec * COMMENTARY_WORDS_PER_SECOND * 0.65),
  );
  const targetWordsMax = Math.max(
    targetWordsMin + 15,
    Math.ceil(durationSec * COMMENTARY_WORDS_PER_SECOND * 1.1),
  );
  const events = analysis.events.filter(
    (event) => event.endMs >= bucket.startMs && event.startMs <= bucket.endMs,
  );
  const label = formatChapterLabel(bucket.startMs, raceDurationMs, index);
  return {
    label,
    startMs: bucket.startMs,
    endMs: bucket.endMs,
    summaries: bucket.summaries,
    events,
    targetWordsMin,
    targetWordsMax,
  };
}

function formatChapterLabel(
  startMs: number,
  raceDurationMs: number,
  index: number,
): string {
  const minutes = Math.floor(startMs / 60_000);
  const seconds = Math.floor((startMs % 60_000) / 1_000);
  const stamp = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  if (startMs < 60_000) return `Lap 1 / start (${stamp})`;
  if (startMs >= raceDurationMs - 90_000) return `Final stint (${stamp})`;
  return `Race segment ${index + 1} (${stamp})`;
}

export function targetWordsForChapter(chapter: CommentaryTimelineChapter): string {
  return `${chapter.targetWordsMin}–${chapter.targetWordsMax} words`;
}

function overlapsTimeWindow(
  startMs: number,
  endMs: number,
  windowStart: number,
  windowEnd: number,
): boolean {
  return endMs >= windowStart && startMs <= windowEnd;
}

export function timelineSummariesForWindow(
  analysis: RaceAnalysis,
  startMs: number,
  endMs: number,
): string[] {
  const beats = analysis.timeline
    .filter((entry) =>
      overlapsTimeWindow(entry.startMs, entry.endMs, startMs, endMs),
    )
    .map((entry) => entry.summary.trim())
    .filter((summary) => summary.length > 0);
  return [...new Set(beats)];
}
