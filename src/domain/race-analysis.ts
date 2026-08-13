import { z } from "zod";

import type {
  RaceFullVideoMetadata,
  RacePackage,
  RaceTimelineEntry,
} from "./entities";

/**
 * Structured race analysis (FASE A). Hard facts are nullable when unverified —
 * never invent positions, overtakes, or results.
 */

export const RACE_EVENT_KINDS = [
  "overtake",
  "incident",
  "mistake",
  "battle",
  "tyre",
  "strategy",
  "pace_change",
  "defense",
  "other",
] as const;

export type RaceEventKind = (typeof RACE_EVENT_KINDS)[number];

export type RaceFactConfidence = "verified" | "inferred" | "unknown";

export type RaceContext = {
  simulator: string | null;
  track: string | null;
  car: string | null;
  durationSec: number | null;
};

export type RaceResultFacts = {
  /** Free-text quali outcome when known (e.g. "both laps invalid"). */
  qualiResult: string | null;
  startPosition: number | null;
  finishPosition: number | null;
  fieldSize: number | null;
  /**
   * Net position change (start − finish when both known). This is NOT an
   * overtake count — positions can change via others' incidents.
   */
  positionsGained: number | null;
};

export type RaceAnalysisEvent = {
  kind: RaceEventKind;
  startMs: number;
  endMs: number;
  summary: string;
  involvingFocusCar: boolean;
  confidence: RaceFactConfidence;
};

export type RaceStoryline = {
  kind: "main" | "secondary" | "final";
  summary: string;
  /** Why a stranger who does not know the driver would watch. */
  whyWatch: string;
};

export type ShortSegmentAnalysis = {
  shortScore: number;
  startMs: number;
  endMs: number;
  hook: string;
  story: string;
  payoff: string;
  recommendedTitleIt: string;
  recommendedTitleEn: string;
  requiresLocalizedRender: boolean;
  segments?: Array<{ startMs: number; endMs: number }>;
  tags: string[];
  descriptionIt: string;
  descriptionEn: string;
};

export type RaceAnalysis = {
  version: 1;
  focusCarHint: string;
  context: RaceContext;
  results: RaceResultFacts;
  recurringRivals: string[];
  events: RaceAnalysisEvent[];
  timeline: RaceTimelineEntry[];
  storylines: RaceStoryline[];
  mainStoryline: string;
  whyWatch: string;
  potentialHooks: string[];
  shortCandidates: ShortSegmentAnalysis[];
  /** First-person chronological narrative (Italian) for editorial input. */
  narrativeIt: string;
  audioTranscript: string;
};

const nullableString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().min(1).nullable(),
);
const nullablePositiveInt = z.preprocess(
  (value) => (value === "" ? null : value),
  z.number().int().positive().nullable(),
);
const nullableNonNegInt = z.preprocess(
  (value) => (value === "" ? null : value),
  z.number().int().nonnegative().nullable(),
);

export const raceContextSchema = z.object({
  simulator: nullableString,
  track: nullableString,
  car: nullableString,
  durationSec: nullableNonNegInt,
});

export const raceResultFactsSchema = z.object({
  qualiResult: nullableString,
  startPosition: nullablePositiveInt,
  finishPosition: nullablePositiveInt,
  fieldSize: nullablePositiveInt,
  positionsGained: z.preprocess(
    (value) => (value === "" ? null : value),
    z.number().int().nullable(),
  ),
});

export const raceAnalysisEventSchema = z.object({
  kind: z.enum(RACE_EVENT_KINDS),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  summary: z.string().trim().min(1),
  involvingFocusCar: z.boolean(),
  confidence: z.enum(["verified", "inferred", "unknown"]),
});

export const raceStorylineSchema = z.object({
  kind: z.enum(["main", "secondary", "final"]),
  summary: z.string().trim().min(1),
  whyWatch: z.string().trim().min(1),
});

export const shortSegmentAnalysisSchema = z.object({
  shortScore: z.number().min(0).max(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  hook: z.string().trim().min(1),
  story: z.string().trim().min(1),
  payoff: z.string().trim().min(1),
  recommendedTitleIt: z.string().trim().min(1).max(100),
  recommendedTitleEn: z.string().trim().min(1).max(100),
  requiresLocalizedRender: z.boolean(),
  segments: z
    .array(
      z.object({
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().nonnegative(),
      }),
    )
    .max(6)
    .optional(),
  tags: z.array(z.string().trim().min(1)).max(12),
  descriptionIt: z.string().trim().min(1),
  descriptionEn: z.string().trim().min(1),
});

const timelineEntrySchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  summary: z.string().trim().min(1),
  involvingFocusCar: z.boolean(),
});

export const raceAnalysisSchema = z.object({
  version: z.literal(1),
  focusCarHint: z.string().trim().min(1),
  context: raceContextSchema,
  results: raceResultFactsSchema,
  recurringRivals: z.array(z.string().trim().min(1)).max(20),
  events: z.array(raceAnalysisEventSchema).max(120),
  timeline: z.array(timelineEntrySchema).max(80),
  storylines: z.array(raceStorylineSchema).max(8),
  mainStoryline: z.string().trim().min(1),
  whyWatch: z.string().trim().min(1),
  potentialHooks: z.array(z.string().trim().min(1)).max(12),
  shortCandidates: z.array(shortSegmentAnalysisSchema).min(1).max(12),
  narrativeIt: z.string().trim().min(1),
  audioTranscript: z.string(),
});

/** LLM output before we stamp version / merge telemetry / fill audio. */
export const raceAnalysisLlmSchema = raceAnalysisSchema.omit({ version: true });

export type RaceAnalysisLlmOutput = z.infer<typeof raceAnalysisLlmSchema>;

export function computePositionsGained(
  startPosition: number | null,
  finishPosition: number | null,
): number | null {
  if (startPosition == null || finishPosition == null) return null;
  return startPosition - finishPosition;
}

/**
 * Bridge for legacy VO/publish code that still expects RacePackage.
 * Titles/descriptions here are placeholders — editorial localize owns the
 * real IT/EN copy.
 */
export function raceAnalysisToRacePackage(
  analysis: RaceAnalysis,
  fullVideo?: Partial<RaceFullVideoMetadata>,
): RacePackage {
  return {
    focusCarHint: analysis.focusCarHint,
    transcript: analysis.narrativeIt,
    timeline: analysis.timeline,
    fullVideo: {
      title:
        fullVideo?.title ??
        analysis.potentialHooks[0] ??
        analysis.mainStoryline.slice(0, 90),
      description:
        fullVideo?.description ??
        [analysis.whyWatch, analysis.narrativeIt].join("\n\n"),
      tags: fullVideo?.tags ?? ["iRacing", "simracing"],
    },
    audioTranscript: analysis.audioTranscript,
  };
}

export function isRaceAnalysis(value: unknown): value is RaceAnalysis {
  return raceAnalysisSchema.safeParse(value).success;
}
