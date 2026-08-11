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
};

export type RequestReplayCapture = (input: {
  sessionId: string;
  watchDir?: string;
  timeoutMs?: number;
}) => Promise<ReplaySession>;

export function createRequestReplayCapture(
  deps: Dependencies,
): RequestReplayCapture {
  const log = deps.logger.child({ operation: "requestReplayCapture" });
  const defaultTimeoutMs = deps.defaultTimeoutMs ?? 15 * 60_000;

  return async (input) => {
    const startedAt = performance.now();
    const session = await deps.replaySessions.getById(input.sessionId);
    if (!session) {
      throw new Error(`Replay session not found: ${input.sessionId}`);
    }

    const watchDir = input.watchDir?.trim() || deps.capture.defaultVideosDir();
    const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
    const since = deps.clock.now();

    log.info("Replay capture waiting for new recording", {
      sessionId: session.id,
      rpyPath: session.rpyPath,
      watchDir,
      timeoutMs,
      hint: "Open the .rpy in iRacing and start in-sim capture (Ctrl+Alt+Shift+V) or OBS hotkey",
    });

    await deps.replaySessions.save({
      ...session,
      status: "capturing",
      updatedAt: since,
    });

    try {
      const mediaPath = await deps.capture.waitForNewRecording({
        watchDir,
        since,
        timeoutMs,
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
      log.info("Replay capture attached media", {
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
      log.error("Replay capture failed", {
        sessionId: session.id,
        watchDir,
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
