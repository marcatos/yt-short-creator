import type { ReplayEvent, ShortCandidate } from "@/src/domain/entities";
import {
  selectTelemetryEvents,
  shouldPreferTelemetry,
  windowAroundEvent,
} from "@/src/domain/replay";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { IdPort } from "@/src/ports/id";
import type { IbtTelemetryPort } from "@/src/ports/ibt-telemetry";
import type { LlmPort } from "@/src/ports/llm";
import type { Logger } from "@/src/ports/logger";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";
import { z } from "zod";

const clipWindowSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).max(12),
  score: z.number().min(0).max(1),
  hookReason: z.string().trim().min(1),
});

const analysisSchema = z.object({
  windows: z.array(clipWindowSchema).max(10),
});

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["windows"],
  properties: {
    windows: {
      type: "array",
      maxItems: 10,
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
        ],
        properties: {
          startMs: { type: "integer", minimum: 0 },
          endMs: { type: "integer", minimum: 1 },
          title: { type: "string" },
          description: { type: "string" },
          tags: { type: "array", items: { type: "string" }, maxItems: 12 },
          score: { type: "number", minimum: 0, maximum: 1 },
          hookReason: { type: "string" },
        },
      },
    },
  },
} satisfies Record<string, unknown>;

type Dependencies = {
  replaySessions: ReplaySessionRepository;
  candidates: CandidateRepository;
  ibtTelemetry: IbtTelemetryPort;
  llm: LlmPort;
  id: IdPort;
  clock: ClockPort;
  logger: Logger;
};

export type RunReplayAnalysis = (input: {
  sessionId: string;
}) => Promise<ShortCandidate[]>;

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
          "Replay session has no media. Attach an MP4 or complete capture first.",
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
          log.warn("IBT telemetry parse failed; falling back to LLM", {
            sessionId,
            error:
              error instanceof Error
                ? { message: error.message, stack: error.stack }
                : String(error),
            durationMs: Math.round(performance.now() - ibtStarted),
          });
        }
      }

      const preferTelemetry = shouldPreferTelemetry(telemetryEvents);
      let candidates: ShortCandidate[] = [];

      if (preferTelemetry) {
        const selected = selectTelemetryEvents(telemetryEvents).slice(0, 10);
        candidates = selected.map((event) =>
          candidateFromTelemetryEvent(
            deps,
            sessionId,
            event,
            session.durationSec,
            trackName,
            session.title,
          ),
        );
        log.info("Using telemetry events for candidates", {
          sessionId,
          telemetryCount: selected.length,
        });
      } else {
        const llmStarted = performance.now();
        const response = await deps.llm.complete({
          system:
            "Identify compelling self-contained vertical-video moments from an iRacing replay capture. Return 8-60 second windows only, using millisecond timestamps and truthful metadata.",
          user: [
            `Replay title: ${session.title}`,
            trackName ? `Track: ${trackName}` : null,
            session.durationSec
              ? `Duration: ${session.durationSec} seconds`
              : null,
            `Local media reference: ${session.mediaPath}`,
            "Select up to 10 moments. Prefer overtakes, incidents recovery, best laps, and strong opening hooks.",
          ]
            .filter(Boolean)
            .join("\n"),
          jsonSchema: responseJsonSchema,
        });
        const parsed = analysisSchema.parse(JSON.parse(response));
        const maxEndMs =
          session.durationSec !== null && session.durationSec > 0
            ? session.durationSec * 1_000
            : Number.POSITIVE_INFINITY;
        const now = deps.clock.now();
        const llmEvents: ReplayEvent[] = [];
        candidates = parsed.windows
          .filter(({ startMs, endMs }) => {
            const durationMs = endMs - startMs;
            return (
              endMs <= maxEndMs &&
              durationMs >= 8_000 &&
              durationMs <= 60_000
            );
          })
          .map((window) => {
            const event: ReplayEvent = {
              id: deps.id.generate(),
              type: "llm_moment",
              startMs: window.startMs,
              endMs: window.endMs,
              score: window.score,
              title: window.title,
              hookReason: window.hookReason,
            };
            llmEvents.push(event);
            return {
              id: deps.id.generate(),
              origin: "replay" as const,
              status: "proposed" as const,
              title: window.title,
              description: [window.description, "#Shorts", "#iRacing"].join(
                "\n",
              ),
              tags: [...window.tags, "Shorts", "iRacing"].slice(0, 12),
              score: window.score,
              provenance: {
                replaySessionId: sessionId,
                startMs: window.startMs,
                endMs: window.endMs,
                hookReason: window.hookReason,
                eventType: "llm_moment" as const,
                crop: { mode: "center_vertical" as const, focusX: 0.5 },
              },
              renderOutputPath: null,
              scheduledAt: null,
              createdAt: now,
              updatedAt: now,
            };
          });
        telemetryEvents = [...telemetryEvents, ...llmEvents];
        log.info("LLM fallback produced candidates", {
          sessionId,
          proposedCount: candidates.length,
          durationMs: Math.round(performance.now() - llmStarted),
        });
      }

      await Promise.all(
        candidates.map((candidate) => deps.candidates.save(candidate)),
      );

      await deps.replaySessions.save({
        ...session,
        trackName,
        events: telemetryEvents,
        status: "ready",
        updatedAt: deps.clock.now(),
      });

      log.info("Replay analysis completed", {
        sessionId,
        source: preferTelemetry ? "telemetry" : "llm",
        proposedCount: candidates.length,
        telemetryEventCount: telemetryEvents.length,
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
