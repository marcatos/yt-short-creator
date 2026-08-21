import type {
  RaceTimelineEntry,
  ReplayEvent,
  ReplaySegment,
  ShortCandidate,
} from "@/src/domain/entities";
import { DEFAULT_FOCUS_CAR_HINT as FOCUS_CAR_DEFAULT } from "@/src/domain/entities";
import {
  applyCommentaryOffset,
  boostScoreNearLapMarkers,
  demoteScoreBeforeRaceStart,
  extractHeuristicMarkers,
  filterMarkersInDuration,
  firstRaceStartMs,
  formatCommentaryMarkersForPrompt,
  formatTranscriptSegmentsForPrompt,
  mergeCommentaryMarkers,
  segmentsWithoutHeuristicMatch,
  type AudioTranscriptSegment,
  type CommentaryMarker,
} from "@/src/domain/commentary-markers";
import {
  computePositionsGained,
  raceAnalysisLlmSchema,
  raceAnalysisToRacePackage,
  type RaceAnalysis,
  type ShortSegmentAnalysis,
} from "@/src/domain/race-analysis";
import {
  battleWindowsToEvents,
  boostScoreNearHudBattles,
  boostScoreNearHudCallouts,
  collectRecurringRivals,
  demoteScoreAfterRaceEnd,
  detectBattleWindows,
  detectCalloutWindows,
  detectRaceEndMs,
  filterRacingEventsBeforeRaceEnd,
  formatHudTimelineForPrompt,
  inferResultsFromHud,
  resolveFocusSubject,
  type HudBattleWindow,
  type RaceHudTimeline,
} from "@/src/domain/race-hud";
import {
  selectTelemetryEvents,
  windowAroundEvent,
} from "@/src/domain/replay";
import type { InspirationConfig } from "@/src/domain/inspiration-config";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { IdPort } from "@/src/ports/id";
import type { IbtTelemetryPort } from "@/src/ports/ibt-telemetry";
import type { InspirationStorePort } from "@/src/ports/inspiration-store";
import type { LlmPort, LlmUserPart } from "@/src/ports/llm";
import type { Logger } from "@/src/ports/logger";
import type { MediaProxyPort, ProxyFrame } from "@/src/ports/media-proxy";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { RaceHudExtractorPort } from "@/src/ports/race-hud-extractor";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";
import type { TranscriptionPort } from "@/src/ports/transcription";
import { z } from "zod";

import { applyInspirationToBatchIfConfigured } from "./apply-inspiration-to-batch";
import { loadInspirationPromptBlock } from "./inspiration-prompt-block";
import { resolveAnalysisAudio } from "./resolve-analysis-audio";

const MAX_SHORTS = 16;
/** LLM may propose extra windows so Inspiration can promote matches into the kept set. */
const CANDIDATE_POOL_MAX = 24;
const MIN_SHORTS = 10;
const VISION_CHUNK_SIZE = 24;
const MIN_WINDOW_MS = 8_000;
/** Short candidates with VO need room for 8–25s narration; prefer 15s+. */
const MIN_SHORT_CANDIDATE_MS = 15_000;
const MAX_WINDOW_MS = 60_000;

const analysisSchema = z.object({
  raceAnalysis: raceAnalysisLlmSchema,
  proposedCommentaryMarkers: z
    .array(
      z.object({
        kind: z.enum(["race_start", "lap", "race_end"]),
        timeMs: z.number().int(),
        rawText: z.string().trim().min(1),
        lapNumber: z.number().int().positive().optional(),
      }),
    )
    .default([]),
});

const visionChunkSchema = z.object({
  moments: z.array(
    z.object({
      timeMs: z.number().int().nonnegative(),
      summary: z.string().trim().min(1),
      involvingFocusCar: z.boolean(),
      interest: z.number().min(0).max(1),
    }),
  ),
});

const nullableStringSchema = { type: ["string", "null"] } as const;
const nullableIntSchema = { type: ["integer", "null"] } as const;

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["raceAnalysis", "proposedCommentaryMarkers"],
  properties: {
    raceAnalysis: {
      type: "object",
      additionalProperties: false,
      required: [
        "focusCarHint",
        "context",
        "results",
        "recurringRivals",
        "events",
        "timeline",
        "storylines",
        "mainStoryline",
        "whyWatch",
        "potentialHooks",
        "shortCandidates",
        "narrativeIt",
        "audioTranscript",
      ],
      properties: {
        focusCarHint: { type: "string" },
        context: {
          type: "object",
          additionalProperties: false,
          required: ["simulator", "track", "car", "durationSec"],
          properties: {
            simulator: nullableStringSchema,
            track: nullableStringSchema,
            car: nullableStringSchema,
            durationSec: nullableIntSchema,
          },
        },
        results: {
          type: "object",
          additionalProperties: false,
          required: [
            "qualiResult",
            "startPosition",
            "finishPosition",
            "fieldSize",
            "positionsGained",
          ],
          properties: {
            qualiResult: nullableStringSchema,
            startPosition: nullableIntSchema,
            finishPosition: nullableIntSchema,
            fieldSize: nullableIntSchema,
            positionsGained: nullableIntSchema,
          },
        },
        recurringRivals: {
          type: "array",
          maxItems: 20,
          items: { type: "string" },
        },
        events: {
          type: "array",
          maxItems: 120,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "kind",
              "startMs",
              "endMs",
              "summary",
              "involvingFocusCar",
              "confidence",
            ],
            properties: {
              kind: {
                type: "string",
                enum: [
                  "overtake",
                  "incident",
                  "mistake",
                  "battle",
                  "tyre",
                  "strategy",
                  "pace_change",
                  "defense",
                  "other",
                ],
              },
              startMs: { type: "integer", minimum: 0 },
              endMs: { type: "integer", minimum: 0 },
              summary: { type: "string" },
              involvingFocusCar: { type: "boolean" },
              confidence: {
                type: "string",
                enum: ["verified", "inferred", "unknown"],
              },
            },
          },
        },
        timeline: {
          type: "array",
          maxItems: 80,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["startMs", "endMs", "summary", "involvingFocusCar"],
            properties: {
              startMs: { type: "integer", minimum: 0 },
              endMs: { type: "integer", minimum: 0 },
              summary: { type: "string" },
              involvingFocusCar: { type: "boolean" },
            },
          },
        },
        storylines: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "summary", "whyWatch"],
            properties: {
              kind: { type: "string", enum: ["main", "secondary", "final"] },
              summary: { type: "string" },
              whyWatch: { type: "string" },
            },
          },
        },
        mainStoryline: { type: "string" },
        whyWatch: { type: "string" },
        potentialHooks: {
          type: "array",
          maxItems: 12,
          items: { type: "string" },
        },
        shortCandidates: {
          type: "array",
          minItems: 1,
          maxItems: CANDIDATE_POOL_MAX,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "shortScore",
              "startMs",
              "endMs",
              "hook",
              "story",
              "payoff",
              "recommendedTitleIt",
              "recommendedTitleEn",
              "requiresLocalizedRender",
              "segments",
              "tags",
              "descriptionIt",
              "descriptionEn",
            ],
            properties: {
              shortScore: { type: "number", minimum: 0, maximum: 1 },
              startMs: { type: "integer", minimum: 0 },
              endMs: { type: "integer", minimum: 1 },
              hook: { type: "string" },
              story: { type: "string" },
              payoff: { type: "string" },
              recommendedTitleIt: { type: "string" },
              recommendedTitleEn: { type: "string" },
              requiresLocalizedRender: { type: "boolean" },
              segments: {
                type: "array",
                maxItems: 6,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["startMs", "endMs"],
                  properties: {
                    startMs: { type: "integer", minimum: 0 },
                    endMs: { type: "integer", minimum: 1 },
                  },
                },
              },
              tags: {
                type: "array",
                maxItems: 12,
                items: { type: "string" },
              },
              descriptionIt: { type: "string" },
              descriptionEn: { type: "string" },
            },
          },
        },
        narrativeIt: { type: "string" },
        audioTranscript: { type: "string" },
      },
    },
    proposedCommentaryMarkers: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "timeMs", "rawText"],
        properties: {
          kind: {
            type: "string",
            enum: ["race_start", "lap", "race_end"],
          },
          timeMs: { type: "integer" },
          rawText: { type: "string" },
          lapNumber: { type: "integer", minimum: 1 },
        },
      },
    },
  },
} satisfies Record<string, unknown>;

const visionChunkJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["moments"],
  properties: {
    moments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["timeMs", "summary", "involvingFocusCar", "interest"],
        properties: {
          timeMs: { type: "integer", minimum: 0 },
          summary: { type: "string" },
          involvingFocusCar: { type: "boolean" },
          interest: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
} satisfies Record<string, unknown>;

type Dependencies = {
  replaySessions: ReplaySessionRepository;
  candidates: CandidateRepository;
  ibtTelemetry: IbtTelemetryPort;
  mediaProxy: MediaProxyPort;
  transcription: TranscriptionPort;
  mediaStore: MediaStorePort;
  raceHudExtractor: RaceHudExtractorPort;
  llm: LlmPort;
  id: IdPort;
  clock: ClockPort;
  logger: Logger;
  inspirationStore?: InspirationStorePort;
  inspirationConfig?: InspirationConfig;
};

export type RunReplayAnalysis = (input: {
  sessionId: string;
  /** Operator-verified race facts injected into the LLM prompt (not invented by vision). */
  operatorNotes?: string | null;
}) => Promise<ShortCandidate[]>;

type VisionMoment = {
  timeMs: number;
  summary: string;
  involvingFocusCar: boolean;
  interest: number;
};

function chunkFrames<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1_000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function windowDurationMs(window: {
  startMs: number;
  endMs: number;
  segments?: ReplaySegment[];
}): number {
  if (window.segments?.length) {
    return window.segments.reduce(
      (sum, segment) => sum + Math.max(0, segment.endMs - segment.startMs),
      0,
    );
  }
  return window.endMs - window.startMs;
}

function normalizeSegments(
  startMs: number,
  endMs: number,
  segments: ReplaySegment[] | undefined,
  maxEndMs: number,
): { startMs: number; endMs: number; segments?: ReplaySegment[] } {
  if (!segments?.length) {
    return { startMs, endMs };
  }
  const cleaned = segments
    .map((segment) => ({
      startMs: Math.max(0, Math.min(segment.startMs, maxEndMs)),
      endMs: Math.max(0, Math.min(segment.endMs, maxEndMs)),
    }))
    .filter((segment) => segment.endMs > segment.startMs);
  if (cleaned.length < 2) {
    return { startMs, endMs };
  }
  return {
    startMs: cleaned[0]!.startMs,
    endMs: cleaned[cleaned.length - 1]!.endMs,
    segments: cleaned,
  };
}

function boostScoreNearTelemetry(
  score: number,
  startMs: number,
  endMs: number,
  telemetry: ReplayEvent[],
): number {
  const mid = (startMs + endMs) / 2;
  const near = telemetry.some((event) => {
    const eventMid = (event.startMs + event.endMs) / 2;
    return Math.abs(eventMid - mid) <= 8_000;
  });
  return near ? Math.min(1, score + 0.08) : score;
}

function mergeHudIntoTimeline(
  timeline: RaceTimelineEntry[],
  battleWindows: HudBattleWindow[],
): RaceTimelineEntry[] {
  const extras: RaceTimelineEntry[] = battleWindows.map((window) => ({
    startMs: window.startMs,
    endMs: window.endMs,
    summary: window.summary,
    involvingFocusCar: true,
  }));
  return [...timeline, ...extras].sort((a, b) => a.startMs - b.startMs);
}

function mergeUniqueRivals(
  fromLlm: string[],
  fromHud: string[],
  limit = 20,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rival of [...fromHud, ...fromLlm]) {
    const key = rival.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(rival.trim());
    if (out.length >= limit) break;
  }
  return out;
}

function clampWindow(
  startMs: number,
  endMs: number,
  maxEndMs: number,
): { startMs: number; endMs: number } {
  let start = Math.max(0, Math.floor(startMs));
  let end = Math.max(start + 1, Math.floor(endMs));
  if (Number.isFinite(maxEndMs)) {
    end = Math.min(end, maxEndMs);
    start = Math.min(start, Math.max(0, end - 1));
  }
  let duration = end - start;
  if (duration < MIN_WINDOW_MS) {
    end = Math.min(
      Number.isFinite(maxEndMs) ? maxEndMs : start + MIN_WINDOW_MS,
      start + MIN_WINDOW_MS,
    );
    duration = end - start;
    if (duration < MIN_WINDOW_MS) {
      start = Math.max(0, end - MIN_WINDOW_MS);
    }
  }
  if (end - start > MAX_WINDOW_MS) {
    end = start + MAX_WINDOW_MS;
  }
  return { startMs: Math.floor(start), endMs: Math.floor(end) };
}

function candidatesFromVisionMoments(
  deps: Dependencies,
  sessionId: string,
  moments: VisionMoment[],
  durationSec: number,
  existingStarts: number[],
  needed: number,
): ShortCandidate[] {
  const maxEndMs = durationSec > 0 ? durationSec * 1_000 : Number.POSITIVE_INFINITY;
  const now = deps.clock.now();
  const ranked = [...moments]
    .filter((moment) => moment.involvingFocusCar && moment.interest >= 0.55)
    .sort((a, b) => b.interest - a.interest);

  const extras: ShortCandidate[] = [];
  for (const moment of ranked) {
    if (extras.length >= needed) break;
    if (
      existingStarts.some((start) => Math.abs(start - moment.timeMs) < 6_000)
    ) {
      continue;
    }
    const window = clampWindow(
      moment.timeMs - 3_000,
      moment.timeMs + 12_000,
      maxEndMs,
    );
    if (window.endMs - window.startMs < MIN_WINDOW_MS) continue;
    extras.push({
      id: deps.id.generate(),
      origin: "replay",
      status: "proposed",
      title: moment.summary.slice(0, 80) || "Momento gara",
      description: `${moment.summary}\n#Shorts\n#iRacing`,
      tags: ["Shorts", "iRacing", "highlight"],
      score: moment.interest,
      provenance: {
        replaySessionId: sessionId,
        startMs: window.startMs,
        endMs: window.endMs,
        hookReason: moment.summary,
        eventType: "llm_moment",
        crop: { mode: "center_vertical", focusX: 0.5 },
      },
      renderOutputPath: null,
      scheduledAt: null,
      createdAt: now,
      updatedAt: now,
    });
    existingStarts.push(window.startMs);
  }
  return extras;
}

function candidateFromTelemetryEvent(
  deps: Dependencies,
  sessionId: string,
  event: ReplayEvent,
  durationSec: number | null,
  trackName: string | null,
  titleFallback: string,
): ShortCandidate {
  const window = windowAroundEvent(event, durationSec);
  const now = deps.clock.now();
  return {
    id: deps.id.generate(),
    origin: "replay",
    status: "proposed",
    title: event.title ?? `${event.type.replace("_", " ")} — ${titleFallback}`,
    description: [
      event.hookReason,
      trackName ? `Track: ${trackName}` : null,
      "#Shorts",
      "#iRacing",
    ]
      .filter(Boolean)
      .join("\n"),
    tags: ["Shorts", "iRacing", event.type],
    score: event.score,
    provenance: {
      replaySessionId: sessionId,
      startMs: window.startMs,
      endMs: window.endMs,
      hookReason: event.hookReason,
      eventType: event.type,
      crop: { mode: "center_vertical", focusX: 0.5 },
    },
    renderOutputPath: null,
    scheduledAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function analyzeVisionChunks(
  deps: Dependencies,
  frames: ProxyFrame[],
  focusCarHint: string,
  log: Logger,
): Promise<VisionMoment[]> {
  const chunks = chunkFrames(frames, VISION_CHUNK_SIZE);
  const moments: VisionMoment[] = [];
  let index = 0;
  for (const chunk of chunks) {
    index += 1;
    const chunkStarted = performance.now();
    const stampList = chunk
      .map((frame) => `${formatMs(frame.timeMs)} (${frame.timeMs}ms)`)
      .join(", ");
    const userParts: LlmUserPart[] = [
      {
        type: "text",
        text: [
          `You are analyzing an iRacing OBS race capture. Focus car: ${focusCarHint}.`,
          "Each image is labeled by its timestamp below in order.",
          "Describe only what is visible. Prefer moments involving the focus car (battles, overtakes, mistakes, recoveries, starts, finishes).",
          "Distinguish a race finish (checkered / last lap at speed) from post-race cool-down or pit-in (cars slowing to stop / return to pits) — do not describe the latter as failed overtakes or lost positions.",
          "Use the provided timeMs values exactly; do not invent timestamps outside the list.",
          `Frame timestamps in order: ${stampList}`,
        ].join("\n"),
      },
    ];
    for (const frame of chunk) {
      userParts.push({
        type: "text",
        text: `Frame at ${formatMs(frame.timeMs)} (${frame.timeMs} ms)`,
      });
      userParts.push({ type: "image", imagePathOrUrl: frame.path });
    }

    const response = await deps.llm.complete({
      system:
        "Return JSON moments for racing highlight detection. Be concise and truthful.",
      user: "",
      userParts,
      jsonSchema: visionChunkJsonSchema,
    });
    const parsed = visionChunkSchema.parse(JSON.parse(response));
    moments.push(...parsed.moments);
    log.info("Vision chunk analyzed", {
      chunk: index,
      totalChunks: chunks.length,
      frameCount: chunk.length,
      momentCount: parsed.moments.length,
      durationMs: Math.round(performance.now() - chunkStarted),
    });
  }
  return moments;
}

function mergeTelemetryIntoTimeline(
  timeline: RaceTimelineEntry[],
  telemetry: ReplayEvent[],
): RaceTimelineEntry[] {
  const extras: RaceTimelineEntry[] = selectTelemetryEvents(telemetry).map(
    (event) => ({
      startMs: event.startMs,
      endMs: event.endMs,
      summary: event.hookReason || event.title || event.type,
      involvingFocusCar: true,
    }),
  );
  return [...timeline, ...extras].sort((a, b) => a.startMs - b.startMs);
}

export function createRunReplayAnalysis(
  deps: Dependencies,
): RunReplayAnalysis {
  const log = deps.logger.child({ operation: "runReplayAnalysis" });

  return async ({ sessionId, operatorNotes }) => {
    const startedAt = performance.now();
    const notes =
      typeof operatorNotes === "string" ? operatorNotes.trim() : "";
    log.info("Replay analysis started", {
      sessionId,
      hasOperatorNotes: notes.length > 0,
      operatorNotesChars: notes.length,
    });

    try {
      const session = await deps.replaySessions.getById(sessionId);
      if (!session) {
        throw new Error(`Replay session not found: ${sessionId}`);
      }
      if (!session.mediaPath) {
        throw new Error(
          "Replay session has no media. Attach an MP4/MKV or complete capture first.",
        );
      }

      await deps.replaySessions.save({
        ...session,
        status: "analyzing",
        updatedAt: deps.clock.now(),
      });

      let telemetryEvents: ReplayEvent[] = [];
      let trackName = session.trackName;

      if (session.ibtPath) {
        const ibtStarted = performance.now();
        try {
          const parsed = await deps.ibtTelemetry.parse(session.ibtPath);
          telemetryEvents = parsed.events.map((event) => ({
            ...event,
            id: event.id || deps.id.generate(),
          }));
          if (parsed.trackName && !trackName) {
            trackName = parsed.trackName;
          }
          log.info("IBT telemetry parsed", {
            sessionId,
            eventCount: telemetryEvents.length,
            durationMs: Math.round(performance.now() - ibtStarted),
          });
        } catch (error) {
          log.warn("IBT telemetry parse failed; continuing with AV analysis", {
            sessionId,
            error:
              error instanceof Error
                ? { message: error.message, stack: error.stack }
                : String(error),
            durationMs: Math.round(performance.now() - ibtStarted),
          });
        }
      }

      const proxyStarted = performance.now();
      const proxy = await deps.mediaProxy.ensureProxy({
        mediaPath: session.mediaPath,
        outDir: deps.mediaStore.replayAnalysisDir(sessionId),
      });
      log.info("Media proxy ready for analysis", {
        sessionId,
        reused: proxy.reused,
        frameCount: proxy.frames.length,
        durationSec: proxy.durationSec,
        durationMs: Math.round(performance.now() - proxyStarted),
      });

      const durationSec = session.durationSec ?? proxy.durationSec;
      const maxEndMs =
        durationSec > 0 ? durationSec * 1_000 : Number.POSITIVE_INFINITY;

      let audioTranscriptText = "";
      let audioSegmentsText = "";
      let audioTranscriptSegments: AudioTranscriptSegment[] = [];
      let heuristicMarkers: CommentaryMarker[] = [];
      let unmatchedCommentarySegments: AudioTranscriptSegment[] = [];
      const analysisAudio = resolveAnalysisAudio({
        commentaryPath: session.commentaryPath,
        commentaryOffsetMs: session.commentaryOffsetMs,
        muxedAudioPath: proxy.audioPath,
      });
      const whisperStarted = performance.now();
      try {
        const transcript = await deps.transcription.transcribe(
          analysisAudio.path,
        );
        audioTranscriptSegments = applyCommentaryOffset(
          transcript.segments.map((segment) => ({
            startMs: segment.startMs,
            endMs: segment.endMs,
            text: segment.text,
          })),
          analysisAudio.offsetMs,
        );
        audioTranscriptText = transcript.text;
        audioSegmentsText =
          formatTranscriptSegmentsForPrompt(audioTranscriptSegments);
        if (analysisAudio.kind === "commentary") {
          heuristicMarkers = extractHeuristicMarkers(audioTranscriptSegments);
          unmatchedCommentarySegments =
            segmentsWithoutHeuristicMatch(audioTranscriptSegments);
        }
        log.info("Audio transcription ready", {
          sessionId,
          audioSource: analysisAudio.kind,
          commentaryOffsetMs: analysisAudio.offsetMs,
          segmentCount: audioTranscriptSegments.length,
          heuristicMarkerCount: heuristicMarkers.length,
          textChars: transcript.text.length,
          durationMs: Math.round(performance.now() - whisperStarted),
        });
      } catch (error) {
        if (analysisAudio.kind === "commentary") {
          log.error("Commentary transcription failed", {
            sessionId,
            audioPath: analysisAudio.path,
            error:
              error instanceof Error
                ? { message: error.message, stack: error.stack }
                : String(error),
            durationMs: Math.round(performance.now() - whisperStarted),
          });
          throw error instanceof Error
            ? error
            : new Error(String(error));
        }
        log.warn("Audio transcription failed; continuing with vision timeline", {
          sessionId,
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : String(error),
          durationMs: Math.round(performance.now() - whisperStarted),
        });
      }

      const durationMsBound =
        durationSec > 0 ? durationSec * 1_000 : null;
      heuristicMarkers = filterMarkersInDuration(
        heuristicMarkers,
        durationMsBound,
      );
      const raceStartMs = firstRaceStartMs(heuristicMarkers);

      let hudTimeline: RaceHudTimeline = [];
      const hudStarted = performance.now();
      try {
        hudTimeline = await deps.raceHudExtractor.extract({
          frames: proxy.frames,
          workDir: deps.mediaStore.replayAnalysisDir(sessionId),
        });
        log.info("HUD overlay extract ready", {
          sessionId,
          snapshotCount: hudTimeline.length,
          durationMs: Math.round(performance.now() - hudStarted),
        });
      } catch (error) {
        log.warn("HUD overlay extract failed; continuing without HUD facts", {
          sessionId,
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : String(error),
          durationMs: Math.round(performance.now() - hudStarted),
        });
      }

      const focusSubject = resolveFocusSubject(hudTimeline, FOCUS_CAR_DEFAULT);
      const focusCarHint = focusSubject.hint;
      const raceEndMs = detectRaceEndMs(hudTimeline);
      if (raceEndMs != null) {
        log.info("Race end detected from HUD session strip", {
          sessionId,
          raceEndMs,
          raceEndLabel: formatMs(raceEndMs),
        });
      }
      const battleWindows = detectBattleWindows(hudTimeline, undefined, raceEndMs);
      const calloutWindows = detectCalloutWindows(hudTimeline, raceEndMs);
      const hudPromptBlock = formatHudTimelineForPrompt(hudTimeline);

      const visionMoments = await analyzeVisionChunks(
        deps,
        proxy.frames,
        focusCarHint,
        log,
      );

      const telemetryHint = selectTelemetryEvents(telemetryEvents)
        .map(
          (event) =>
            `${event.type} @ ${formatMs(event.startMs)} score=${event.score}: ${event.hookReason}`,
        )
        .join("\n");

      let inspirationBlock = "";
      try {
        inspirationBlock = await loadInspirationPromptBlock(deps.inspirationStore);
      } catch (error) {
        log.warn("Failed to load inspiration prompt; continuing", {
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : String(error),
        });
      }

      const packageStarted = performance.now();
      const raceEndPrompt =
        raceEndMs != null
          ? `FINE GARA verificata dall'HUD a ${formatMs(raceEndMs)} (${raceEndMs}ms): dopo questo timestamp il footage è POST-RACE (checkered / cool-down / pit-in). Non raccontare sorpassi falliti, battaglie o perdite di posizione da auto che rallentano per rientrare ai box. finishPosition = ultima posizione in gara PRIMA di quel timestamp.`
          : "Se lo strip sessione HUD mostra checkered / cool-down / finished, tratta il footage successivo come POST-RACE (non come battaglia).";
      const response = await deps.llm.complete({
        system: [
          "Sei l'analista editoriale del canale YouTube di Simone Marcato (pilota #42).",
          "FASE A — Race Analysis: estrai la STORIA interessante della gara, non una descrizione passiva.",
          "Stile narrativo (narrativeIt, storylines, hook/story/payoff): prima persona del pilota. Fatti concreti.",
          "REGOLA FONDAMENTALE: non inventare mai posizioni, sorpassi, risultati non verificabili dalle note vision/telemetria/HUD.",
          "I fatti HUD overlay (session strip, focus card, battle/relative, standings, battle-for-P callout, field ticker) sono VERIFIED quando presenti: non contraddarli.",
          "Le NOTE OPERATORE (se presenti) sono VERIFIED come l'HUD: usale per storyline/whyWatch/narrative; non contraddirle; non inventare oltre.",
          "I MARKER COMMENTARY (se presenti) sono VERIFIED (race_start / lap / race_end): allineali alla timeline video; non contraddarli.",
          "proposedCommentaryMarkers: solo frasi ambigue NON già coperte dai marker heuristics; kind in race_start|lap|race_end; timeMs sul clock VIDEO.",
          "Il Focus card identifica il soggetto camera (car # / nome), anche se il branding del canale è #42.",
          "Se non puoi verificare una posizione, metti null. positionsGained = start−finish quando entrambi noti; NON è un conteggio di sorpassi.",
          "Guadagni di posizione per incidenti altrui NON sono overtakes (kind overtake solo se c'è un passaggio chiaro).",
          raceEndPrompt,
          "whyWatch deve rispondere: perché uno sconosciuto guarderebbe questo video? NON perché è una gara di Simone.",
          "shortScore: immediatezza, comprensione senza contesto, qualità sorpasso, rischio, vicinanza, tensione, payoff, hook.",
          "requiresLocalizedRender=true SOLO se lo Short ha bisogno di testo burned-in in lingua (caption dinamiche IT/EN diverse).",
          `Proponi tra ${MIN_SHORTS} e ${CANDIDATE_POOL_MAX} shortCandidates (15–45s tipici, max 60s); ne terremo ${MAX_SHORTS} dopo il ranking. segments opzionali non contigui.`,
          `Focus car: ${focusCarHint}.`,
        ].join(" "),
        user: [
          `Titolo sessione: ${session.title}`,
          trackName ? `Pista: ${trackName}` : null,
          `Durata media: ${durationSec} secondi`,
          `Focus car: ${focusCarHint}`,
          focusSubject.carNumber != null
            ? `Focus car number (HUD): #${focusSubject.carNumber}`
            : null,
          focusSubject.driverName
            ? `Focus driver (HUD): ${focusSubject.driverName}`
            : null,
          raceEndMs != null
            ? `Race end (HUD verified): ${formatMs(raceEndMs)} (${raceEndMs}ms)`
            : null,
          raceStartMs != null
            ? `Race start (commentary marker verified): ${formatMs(raceStartMs)} (${raceStartMs}ms)`
            : null,
          notes
            ? `\n=== Note operatore (verified) ===\n${notes}`
            : null,
          "",
          `=== Transcript audio (${analysisAudio.kind}${
            analysisAudio.kind === "commentary"
              ? `, offset ${analysisAudio.offsetMs}ms`
              : ""
          }) ===`,
          audioTranscriptText || "(nessun parlato rilevato)",
          audioSegmentsText
            ? `Segmenti audio (clock video):\n${audioSegmentsText}`
            : null,
          "",
          "=== Commentary markers (verified heuristics) ===",
          formatCommentaryMarkersForPrompt(heuristicMarkers),
          unmatchedCommentarySegments.length
            ? `Segmenti senza match heuristic (candidati LLM):\n${formatTranscriptSegmentsForPrompt(unmatchedCommentarySegments)}`
            : null,
          "",
          "=== HUD overlay (verified when present) ===",
          hudPromptBlock,
          "",
          "=== Momenti vision (campionati) ===",
          visionMoments
            .map(
              (moment) =>
                `${formatMs(moment.timeMs)} (${moment.timeMs}ms) focus=${moment.involvingFocusCar} interest=${moment.interest}: ${moment.summary}`,
            )
            .join("\n") || "(nessun momento)",
          "",
          telemetryHint
            ? `=== Telemetria IBT (boost, non unica fonte) ===\n${telemetryHint}`
            : null,
          inspirationBlock || null,
        ]
          .filter(Boolean)
          .join("\n"),
        jsonSchema: responseJsonSchema,
      });

      const parsed = analysisSchema.parse(JSON.parse(response));
      const llmAnalysis = parsed.raceAnalysis;
      const llmMarkers: CommentaryMarker[] = (
        analysisAudio.kind === "commentary"
          ? parsed.proposedCommentaryMarkers
          : []
      ).map((marker) => ({
        ...marker,
        source: "llm" as const,
      }));
      const commentaryMarkers = filterMarkersInDuration(
        mergeCommentaryMarkers(heuristicMarkers, llmMarkers),
        durationMsBound,
      );
      const resolvedRaceStartMs = firstRaceStartMs(commentaryMarkers);
      const hudResults = inferResultsFromHud(
        hudTimeline,
        focusSubject.carNumber,
        llmAnalysis.results,
        { raceEndMs },
      );
      const positionsGained =
        hudResults.positionsGained ??
        computePositionsGained(
          hudResults.startPosition,
          hudResults.finishPosition,
        );
      const hudEvents = [
        ...battleWindowsToEvents(battleWindows),
        ...battleWindowsToEvents(calloutWindows),
      ];
      const hudRivals = collectRecurringRivals(
        hudTimeline,
        focusSubject.carNumber,
      );

      const raceAnalysis: RaceAnalysis = {
        ...llmAnalysis,
        version: 1,
        focusCarHint:
          focusSubject.carNumber != null || focusSubject.driverName
            ? focusCarHint
            : llmAnalysis.focusCarHint || focusCarHint,
        context: {
          ...llmAnalysis.context,
          track:
            llmAnalysis.context.track ||
            trackName ||
            hudTimeline.find((snap) => snap.session?.trackName)?.session
              ?.trackName ||
            null,
          durationSec:
            llmAnalysis.context.durationSec ??
            (durationSec > 0 ? durationSec : null),
        },
        results: {
          ...hudResults,
          positionsGained,
        },
        recurringRivals: mergeUniqueRivals(
          llmAnalysis.recurringRivals,
          hudRivals,
        ),
        events: filterRacingEventsBeforeRaceEnd(
          [...llmAnalysis.events, ...hudEvents].sort(
            (a, b) => a.startMs - b.startMs,
          ),
          raceEndMs,
        ).slice(0, 120),
        timeline: mergeHudIntoTimeline(
          mergeTelemetryIntoTimeline(llmAnalysis.timeline, telemetryEvents),
          [...battleWindows, ...calloutWindows],
        ),
        audioTranscript:
          audioTranscriptText || llmAnalysis.audioTranscript || "",
        audioSource: analysisAudio.kind,
        audioTranscriptSegments,
        commentaryMarkers,
        hudTimeline,
      };

      const racePackage = raceAnalysisToRacePackage(raceAnalysis);

      log.info("Race analysis drafted", {
        sessionId,
        shortCount: raceAnalysis.shortCandidates.length,
        timelineCount: raceAnalysis.timeline.length,
        hudSnapshotCount: hudTimeline.length,
        focusCarHint: raceAnalysis.focusCarHint.slice(0, 80),
        whyWatch: raceAnalysis.whyWatch.slice(0, 120),
        durationMs: Math.round(performance.now() - packageStarted),
      });

      if (deps.mediaStore.replayDeliveryDir && deps.mediaStore.writeText) {
        const deliveryDir = deps.mediaStore.replayDeliveryDir(sessionId);
        const analysisPath = `${deliveryDir.replace(/\\/g, "/")}/race_analysis.json`;
        await deps.mediaStore.writeText(
          analysisPath,
          JSON.stringify(raceAnalysis, null, 2),
        );
      }

      const now = deps.clock.now();
      const llmEvents: ReplayEvent[] = [];
      let candidates: ShortCandidate[] = raceAnalysis.shortCandidates
        .map((window) => {
          const normalized = normalizeSegments(
            window.startMs,
            window.endMs,
            window.segments && window.segments.length >= 2
              ? window.segments
              : undefined,
            Number.isFinite(maxEndMs) ? maxEndMs : window.endMs,
          );
          const clamped = clampWindow(
            normalized.startMs,
            normalized.endMs,
            Number.isFinite(maxEndMs) ? maxEndMs : normalized.endMs,
          );
          return {
            ...window,
            ...clamped,
            segments: normalized.segments,
          };
        })
        .filter((window) => {
          const durationMs = windowDurationMs(window);
          const endOk =
            !Number.isFinite(maxEndMs) || window.endMs <= maxEndMs;
          return (
            endOk &&
            durationMs >= MIN_SHORT_CANDIDATE_MS &&
            durationMs <= MAX_WINDOW_MS
          );
        })
        .map((window: ShortSegmentAnalysis & {
          startMs: number;
          endMs: number;
          segments?: ReplaySegment[];
        }) => {
          const score = demoteScoreBeforeRaceStart(
            demoteScoreAfterRaceEnd(
              boostScoreNearLapMarkers(
                boostScoreNearHudCallouts(
                  boostScoreNearHudBattles(
                    boostScoreNearTelemetry(
                      window.shortScore,
                      window.startMs,
                      window.endMs,
                      telemetryEvents,
                    ),
                    window.startMs,
                    window.endMs,
                    battleWindows,
                  ),
                  window.startMs,
                  window.endMs,
                  calloutWindows,
                ),
                window.startMs,
                window.endMs,
                commentaryMarkers,
              ),
              window.startMs,
              window.endMs,
              raceEndMs,
            ),
            window.startMs,
            window.endMs,
            resolvedRaceStartMs,
          );
          const event: ReplayEvent = {
            id: deps.id.generate(),
            type: "llm_moment",
            startMs: window.startMs,
            endMs: window.endMs,
            score,
            title: window.recommendedTitleIt,
            hookReason: window.hook,
            payload: {
              ...(window.segments ? { segments: window.segments } : {}),
              requiresLocalizedRender: window.requiresLocalizedRender,
              recommendedTitleEn: window.recommendedTitleEn,
              story: window.story,
              payoff: window.payoff,
            },
          };
          llmEvents.push(event);
          return {
            id: deps.id.generate(),
            origin: "replay" as const,
            status: "proposed" as const,
            title: window.recommendedTitleIt,
            description: [
              window.descriptionIt,
              window.hook,
              "#Shorts",
              "#iRacing",
            ].join("\n"),
            tags: [...window.tags, "Shorts", "iRacing"].slice(0, 12),
            score,
            provenance: {
              replaySessionId: sessionId,
              startMs: window.startMs,
              endMs: window.endMs,
              hookReason: window.hook,
              eventType: "llm_moment" as const,
              crop: { mode: "center_vertical" as const, focusX: 0.5 },
              ...(window.segments ? { segments: window.segments } : {}),
            },
            renderOutputPath: null,
            scheduledAt: null,
            createdAt: now,
            updatedAt: now,
          };
        });

      // Fill with telemetry windows if AV returned fewer than MIN_SHORTS.
      if (candidates.length < MIN_SHORTS) {
        const extras = selectTelemetryEvents(telemetryEvents)
          .filter(
            (event) =>
              !candidates.some(
                (candidate) =>
                  Math.abs(
                    (candidate.provenance as { startMs: number }).startMs -
                      event.startMs,
                  ) < 4_000,
              ),
          )
          .slice(0, MIN_SHORTS - candidates.length)
          .map((event) =>
            candidateFromTelemetryEvent(
              deps,
              sessionId,
              event,
              durationSec,
              trackName,
              session.title,
            ),
          );
        candidates = [...candidates, ...extras];
      }

      if (candidates.length < MIN_SHORTS) {
        const starts = candidates.map(
          (candidate) =>
            (candidate.provenance as { startMs: number }).startMs,
        );
        const visionExtras = candidatesFromVisionMoments(
          deps,
          sessionId,
          visionMoments,
          durationSec,
          starts,
          MIN_SHORTS - candidates.length,
        );
        candidates = [...candidates, ...visionExtras];
        log.info("Filled Shorts from vision moments", {
          sessionId,
          added: visionExtras.length,
          total: candidates.length,
        });
      }

      candidates = candidates.sort((a, b) => b.score - a.score);

      const applied = await applyInspirationToBatchIfConfigured(
        {
          store: deps.inspirationStore,
          config: deps.inspirationConfig,
          clock: deps.clock,
          logger: log,
        },
        candidates,
      );
      candidates = applied.candidates.slice(0, MAX_SHORTS);
      await Promise.all(
        candidates.map((candidate) => deps.candidates.save(candidate)),
      );

      await deps.replaySessions.save({
        ...session,
        trackName,
        durationSec,
        events: [...telemetryEvents, ...llmEvents],
        racePackage,
        raceAnalysis,
        status: "ready",
        updatedAt: deps.clock.now(),
      });

      log.info("Replay analysis completed", {
        sessionId,
        source: "av",
        proposedCount: candidates.length,
        telemetryEventCount: telemetryEvents.length,
        transcriptChars: raceAnalysis.narrativeIt.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return candidates;
    } catch (error) {
      const existing = await deps.replaySessions.getById(sessionId);
      if (existing) {
        await deps.replaySessions.save({
          ...existing,
          status: "failed",
          updatedAt: deps.clock.now(),
        });
      }
      log.error("Replay analysis failed", {
        sessionId,
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error),
        durationMs: Math.round(performance.now() - startedAt),
      });
      throw error;
    }
  };
}
