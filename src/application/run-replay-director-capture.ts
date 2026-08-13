import path from "node:path";

import type { ReplayEvent, ReplaySession, ShortCandidate } from "@/src/domain/entities";
import {
  buildConcatTimeline,
  buildDirectorShotPlan,
  buildIncidentHuntPlan,
} from "@/src/domain/replay-director";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { IdPort } from "@/src/ports/id";
import type { IbtTelemetryPort } from "@/src/ports/ibt-telemetry";
import type { Logger } from "@/src/ports/logger";
import type { MediaDurationPort } from "@/src/ports/media-duration";
import type { ReplayCapturePort } from "@/src/ports/replay-capture";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";

type Dependencies = {
  replaySessions: ReplaySessionRepository;
  candidates: CandidateRepository;
  capture: ReplayCapturePort;
  ibtTelemetry: IbtTelemetryPort;
  mediaDuration: MediaDurationPort;
  id: IdPort;
  clock: ClockPort;
  logger: Logger;
  mediaRoot: string;
  defaultTimeoutMs?: number;
};

export type RunReplayDirectorCapture = (input: {
  sessionId: string;
  watchDir?: string;
  timeoutMs?: number;
  maxShots?: number;
}) => Promise<{
  session: ReplaySession;
  candidates: ShortCandidate[];
}>;

export function createRunReplayDirectorCapture(
  deps: Dependencies,
): RunReplayDirectorCapture {
  const log = deps.logger.child({ operation: "runReplayDirectorCapture" });
  const defaultTimeoutMs = deps.defaultTimeoutMs ?? 45 * 60_000;

  return async (input) => {
    const startedAt = performance.now();
    const session = await deps.replaySessions.getById(input.sessionId);
    if (!session) {
      throw new Error(`Replay session not found: ${input.sessionId}`);
    }

    const watchDir = input.watchDir?.trim() || deps.capture.defaultVideosDir();
    const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
    const now = deps.clock.now();

    log.info("Replay director capture started", {
      sessionId: session.id,
      rpyPath: session.rpyPath,
      hasIbt: Boolean(session.ibtPath),
      maxShots: input.maxShots ?? 8,
    });

    await deps.replaySessions.save({
      ...session,
      status: "capturing",
      updatedAt: now,
    });

    try {
      const rpyPath = session.rpyPath;
      if (!rpyPath) {
        throw new Error(
          `Replay session ${session.id} has no .rpy path for director capture`,
        );
      }
      let events: ReplayEvent[] = [...session.events];
      let trackName = session.trackName;

      if (session.ibtPath) {
        const parsed = await deps.ibtTelemetry.parse(session.ibtPath);
        events = [
          ...events,
          ...parsed.events.map((event) => ({
            ...event,
            id: event.id || deps.id.generate(),
          })),
        ];
        if (parsed.trackName && !trackName) {
          trackName = parsed.trackName;
        }
      }

      const focusCarPosition =
        session.focusCarIdx !== null ? session.focusCarIdx + 1 : 1;
      let shots = buildDirectorShotPlan({
        events,
        focusCarPosition,
        maxShots: input.maxShots,
        durationSec: session.durationSec,
      });

      if (shots.length === 0) {
        log.info("No telemetry shots; using incident-hunt director plan", {
          sessionId: session.id,
        });
        shots = buildIncidentHuntPlan({ focusCarPosition });
      }

      const outputPath = path.join(
        deps.mediaRoot,
        "replays",
        `${session.id}-highlight.mp4`,
      );

      const result = await deps.capture.directedCapture({
        rpyPath,
        watchDir,
        timeoutMs,
        outputPath,
        shots: shots.map((shot) => ({
          id: shot.id,
          seekMs: shot.seekMs,
          recordMs: shot.recordMs,
          carPosition: shot.carPosition,
          cameraGroup: shot.cameraGroup,
          cameraNumber: shot.cameraNumber,
        })),
      });

      const durationSec = await deps.mediaDuration.probeDurationSec(
        result.mediaPath,
      );
      const timeline = buildConcatTimeline(
        shots.slice(0, result.segments.length),
        result.segments.map((segment) => segment.durationMs),
      );
      const createdAt = deps.clock.now();
      const candidates = timeline.map((entry): ShortCandidate => ({
        id: deps.id.generate(),
        origin: "replay",
        status: "proposed",
        title: entry.shot.title,
        description: [
          entry.shot.hookReason,
          trackName ? `Track: ${trackName}` : null,
          "Directed highlight",
          "#Shorts",
          "#iRacing",
        ]
          .filter(Boolean)
          .join("\n"),
        tags: ["Shorts", "iRacing", "director", entry.shot.eventType],
        score: entry.shot.score,
        provenance: {
          replaySessionId: session.id,
          startMs: entry.startMs,
          endMs: entry.endMs,
          hookReason: entry.shot.hookReason,
          eventType: entry.shot.eventType,
          crop: { mode: "center_vertical", focusX: 0.5 },
        },
        renderOutputPath: null,
        scheduledAt: null,
        createdAt,
        updatedAt: createdAt,
      }));

      await Promise.all(
        candidates.map((candidate) => deps.candidates.save(candidate)),
      );

      const updated: ReplaySession = {
        ...session,
        trackName,
        mediaPath: result.mediaPath,
        durationSec: durationSec ?? session.durationSec,
        events: [
          ...events,
          ...timeline.map((entry) => ({
            id: entry.shot.id,
            type: entry.shot.eventType,
            startMs: entry.startMs,
            endMs: entry.endMs,
            score: entry.shot.score,
            title: entry.shot.title,
            hookReason: entry.shot.hookReason,
            payload: { director: true, carPosition: entry.shot.carPosition },
          })),
        ],
        status: "ready",
        updatedAt: deps.clock.now(),
      };
      await deps.replaySessions.save(updated);

      log.info("Replay director capture completed", {
        sessionId: session.id,
        mediaPath: result.mediaPath,
        segmentCount: result.segments.length,
        candidateCount: candidates.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return { session: updated, candidates };
    } catch (error) {
      await deps.replaySessions.save({
        ...session,
        status: "failed",
        updatedAt: deps.clock.now(),
      });
      log.error("Replay director capture failed", {
        sessionId: session.id,
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
