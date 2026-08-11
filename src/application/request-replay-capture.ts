import type { ReplaySession } from "@/src/domain/entities";
import type { ClockPort } from "@/src/ports/clock";
import type { Logger } from "@/src/ports/logger";
import type { MediaDurationPort } from "@/src/ports/media-duration";
import type { ReplayCapturePort } from "@/src/ports/replay-capture";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";

type Dependencies = {
  replaySessions: ReplaySessionRepository;
  capture: ReplayCapturePort;
  mediaDuration: MediaDurationPort;
  clock: ClockPort;
  logger: Logger;
  defaultTimeoutMs?: number;
  defaultPlaySpeed?: number;
};

export type RequestReplayCapture = (input: {
  sessionId: string;
  watchDir?: string;
  timeoutMs?: number;
  playSpeed?: number;
  recordDurationMs?: number;
}) => Promise<ReplaySession>;

export function createRequestReplayCapture(
  deps: Dependencies,
): RequestReplayCapture {
  const log = deps.logger.child({ operation: "requestReplayCapture" });
  const defaultTimeoutMs = deps.defaultTimeoutMs ?? 45 * 60_000;
  const defaultPlaySpeed = deps.defaultPlaySpeed ?? 1;

  return async (input) => {
    const startedAt = performance.now();
    const session = await deps.replaySessions.getById(input.sessionId);
    if (!session) {
      throw new Error(`Replay session not found: ${input.sessionId}`);
    }

    const watchDir = input.watchDir?.trim() || deps.capture.defaultVideosDir();
    const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
    const playSpeed = input.playSpeed ?? defaultPlaySpeed;
    const recordDurationMs =
      input.recordDurationMs ??
      (session.durationSec !== null && session.durationSec > 0
        ? Math.ceil((session.durationSec * 1_000) / playSpeed) + 5_000
        : undefined);
    const since = deps.clock.now();

    log.info("Replay auto-capture started", {
      sessionId: session.id,
      rpyPath: session.rpyPath,
      watchDir,
      timeoutMs,
      playSpeed,
      recordDurationMs: recordDurationMs ?? null,
    });

    await deps.replaySessions.save({
      ...session,
      status: "capturing",
      updatedAt: since,
    });

    try {
      const mediaPath = await deps.capture.autoCapture({
        rpyPath: session.rpyPath,
        watchDir,
        timeoutMs,
        playSpeed,
        recordDurationMs,
      });
      const durationSec = await deps.mediaDuration.probeDurationSec(mediaPath);
      const updated: ReplaySession = {
        ...session,
        mediaPath,
        durationSec: durationSec ?? session.durationSec,
        status: "ready",
        updatedAt: deps.clock.now(),
      };
      await deps.replaySessions.save(updated);
      log.info("Replay auto-capture attached media", {
        sessionId: session.id,
        mediaPath,
        durationSec: updated.durationSec,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return updated;
    } catch (error) {
      await deps.replaySessions.save({
        ...session,
        status: "failed",
        updatedAt: deps.clock.now(),
      });
      log.error("Replay auto-capture failed", {
        sessionId: session.id,
        watchDir,
        rpyPath: session.rpyPath,
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
