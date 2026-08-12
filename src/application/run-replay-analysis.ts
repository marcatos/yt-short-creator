import type {
  RacePackage,
  RaceTimelineEntry,
  ReplayEvent,
  ReplaySegment,
  ShortCandidate,
} from "@/src/domain/entities";
import { DEFAULT_FOCUS_CAR_HINT as FOCUS_CAR_DEFAULT } from "@/src/domain/entities";
import {
  selectTelemetryEvents,
  windowAroundEvent,
} from "@/src/domain/replay";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { IdPort } from "@/src/ports/id";
import type { IbtTelemetryPort } from "@/src/ports/ibt-telemetry";
import type { LlmPort, LlmUserPart } from "@/src/ports/llm";
import type { Logger } from "@/src/ports/logger";
import type { MediaProxyPort, ProxyFrame } from "@/src/ports/media-proxy";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";
import type { TranscriptionPort } from "@/src/ports/transcription";
import { z } from "zod";

const MAX_SHORTS = 16;
const MIN_SHORTS = 10;
const VISION_CHUNK_SIZE = 24;
const MIN_WINDOW_MS = 8_000;
const MAX_WINDOW_MS = 60_000;

const segmentSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
});

const clipWindowSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).max(12),
  score: z.number().min(0).max(1),
  hookReason: z.string().trim().min(1),
  segments: z.array(segmentSchema).max(4).default([]),
});

const timelineEntrySchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  summary: z.string().trim().min(1),
  involvingFocusCar: z.boolean(),
});

const racePackageSchema = z.object({
  focusCarHint: z.string().trim().min(1),
  transcript: z.string().trim().min(1),
  timeline: z.array(timelineEntrySchema).max(80),
  fullVideo: z.object({
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1),
    tags: z.array(z.string().trim().min(1)).max(20),
  }),
  audioTranscript: z.string(),
});

const analysisSchema = z.object({
  racePackage: racePackageSchema,
  windows: z.array(clipWindowSchema).min(MIN_SHORTS).max(MAX_SHORTS),
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

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["racePackage", "windows"],
  properties: {
    racePackage: {
      type: "object",
      additionalProperties: false,
      required: [
        "focusCarHint",
        "transcript",
        "timeline",
        "fullVideo",
        "audioTranscript",
      ],
      properties: {
        focusCarHint: { type: "string" },
        transcript: { type: "string" },
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
        fullVideo: {
          type: "object",
          additionalProperties: false,
          required: ["title", "description", "tags"],
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            tags: { type: "array", items: { type: "string" }, maxItems: 20 },
          },
        },
        audioTranscript: { type: "string" },
      },
    },
    windows: {
      type: "array",
      minItems: MIN_SHORTS,
      maxItems: MAX_SHORTS,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "startMs",
          "endMs",
          "title",
          "description",
          "tags",
          "score",
          "hookReason",
          "segments",
        ],
        properties: {
          startMs: { type: "integer", minimum: 0 },
          endMs: { type: "integer", minimum: 1 },
          title: { type: "string" },
          description: { type: "string" },
          tags: { type: "array", items: { type: "string" }, maxItems: 12 },
          score: { type: "number", minimum: 0, maximum: 1 },
          hookReason: { type: "string" },
          segments: {
            type: "array",
            maxItems: 4,
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
  llm: LlmPort;
  id: IdPort;
  clock: ClockPort;
  logger: Logger;
};

export type RunReplayAnalysis = (input: {
  sessionId: string;
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

  return async ({ sessionId }) => {
    const startedAt = performance.now();
    log.info("Replay analysis started", { sessionId });

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
      const focusCarHint = FOCUS_CAR_DEFAULT;

      let audioTranscriptText = "";
      let audioSegmentsText = "";
      const whisperStarted = performance.now();
      try {
        const transcript = await deps.transcription.transcribe(proxy.audioPath);
        audioTranscriptText = transcript.text;
        audioSegmentsText = transcript.segments
          .map(
            (segment) =>
              `[${formatMs(segment.startMs)}-${formatMs(segment.endMs)}] ${segment.text}`,
          )
          .join("\n");
        log.info("Audio transcription ready", {
          sessionId,
          segmentCount: transcript.segments.length,
          textChars: transcript.text.length,
          durationMs: Math.round(performance.now() - whisperStarted),
        });
      } catch (error) {
        log.warn("Audio transcription failed; continuing with vision timeline", {
          sessionId,
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : String(error),
          durationMs: Math.round(performance.now() - whisperStarted),
        });
      }

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

      const packageStarted = performance.now();
      const response = await deps.llm.complete({
        system: [
          "Sei l'editor del canale YouTube S.Marcato 42 Racing.",
          "Scrivi metadata e Shorts in italiano, catchy, orientati al traffico.",
          `Auto focus (eroe): ${focusCarHint}.`,
          "Usa SOLO timestamp presenti nelle note vision/telemetria; non inventare secondi fuori range.",
          `Proponi tra ${MIN_SHORTS} e ${MAX_SHORTS} Shorts (8–60s). Alcuni possono montare 2–4 segmenti non contigui (campo segments) se aumenta l'hook.`,
          "Il campo transcript deve essere una narrativa cronologica della gara (non solo speech-to-text).",
          "fullVideo.title max ~90 caratteri; description completa con CTA al canale e hashtag pertinenti.",
        ].join(" "),
        user: [
          `Titolo sessione: ${session.title}`,
          trackName ? `Pista: ${trackName}` : null,
          `Durata media: ${durationSec} secondi`,
          `Focus car: ${focusCarHint}`,
          "",
          "=== Transcript audio (può essere vuoto / solo engine) ===",
          audioTranscriptText || "(nessun parlato rilevato)",
          audioSegmentsText
            ? `Segmenti audio:\n${audioSegmentsText}`
            : null,
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
        ]
          .filter(Boolean)
          .join("\n"),
        jsonSchema: responseJsonSchema,
      });

      const parsed = analysisSchema.parse(JSON.parse(response));
      log.info("Race package + shorts drafted", {
        sessionId,
        windowCount: parsed.windows.length,
        timelineCount: parsed.racePackage.timeline.length,
        durationMs: Math.round(performance.now() - packageStarted),
      });

      const racePackage: RacePackage = {
        ...parsed.racePackage,
        focusCarHint: parsed.racePackage.focusCarHint || focusCarHint,
        audioTranscript:
          audioTranscriptText || parsed.racePackage.audioTranscript || "",
        timeline: mergeTelemetryIntoTimeline(
          parsed.racePackage.timeline,
          telemetryEvents,
        ),
      };

      const now = deps.clock.now();
      const llmEvents: ReplayEvent[] = [];
      let candidates: ShortCandidate[] = parsed.windows
        .map((window) => {
          const normalized = normalizeSegments(
            window.startMs,
            window.endMs,
            window.segments.length >= 2 ? window.segments : undefined,
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
            durationMs >= MIN_WINDOW_MS &&
            durationMs <= MAX_WINDOW_MS
          );
        })
        .map((window) => {
          const score = boostScoreNearTelemetry(
            window.score,
            window.startMs,
            window.endMs,
            telemetryEvents,
          );
          const event: ReplayEvent = {
            id: deps.id.generate(),
            type: "llm_moment",
            startMs: window.startMs,
            endMs: window.endMs,
            score,
            title: window.title,
            hookReason: window.hookReason,
            payload: window.segments ? { segments: window.segments } : undefined,
          };
          llmEvents.push(event);
          return {
            id: deps.id.generate(),
            origin: "replay" as const,
            status: "proposed" as const,
            title: window.title,
            description: [window.description, "#Shorts", "#iRacing"].join("\n"),
            tags: [...window.tags, "Shorts", "iRacing"].slice(0, 12),
            score,
            provenance: {
              replaySessionId: sessionId,
              startMs: window.startMs,
              endMs: window.endMs,
              hookReason: window.hookReason,
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

      candidates = candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_SHORTS);

      await Promise.all(
        candidates.map((candidate) => deps.candidates.save(candidate)),
      );

      await deps.replaySessions.save({
        ...session,
        trackName,
        durationSec,
        events: [...telemetryEvents, ...llmEvents],
        racePackage,
        status: "ready",
        updatedAt: deps.clock.now(),
      });

      log.info("Replay analysis completed", {
        sessionId,
        source: "av",
        proposedCount: candidates.length,
        telemetryEventCount: telemetryEvents.length,
        transcriptChars: racePackage.transcript.length,
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
