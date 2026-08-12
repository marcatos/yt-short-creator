import type { ReplaySession } from "@/src/domain/entities";
import {
  defaultTitleFromMediaPath,
  defaultTitleFromRpyPath,
} from "@/src/domain/replay";
import type { ClockPort } from "@/src/ports/clock";
import type { IdPort } from "@/src/ports/id";
import type { Logger } from "@/src/ports/logger";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";

type Dependencies = {
  replaySessions: ReplaySessionRepository;
  id: IdPort;
  clock: ClockPort;
  logger: Logger;
};

export type CreateReplaySession = (input: {
  rpyPath?: string | null;
  title?: string;
  trackName?: string | null;
  focusCarIdx?: number | null;
  ibtPath?: string | null;
  mediaPath?: string | null;
}) => Promise<ReplaySession>;

export function createCreateReplaySession(
  deps: Dependencies,
): CreateReplaySession {
  const log = deps.logger.child({ operation: "createReplaySession" });

  return async (input) => {
    const startedAt = performance.now();
    const rpyPath = input.rpyPath?.trim() || null;
    const mediaPath = input.mediaPath?.trim() || null;
    if (!rpyPath && !mediaPath) {
      throw new Error("Either rpyPath or mediaPath is required");
    }

    const now = deps.clock.now();
    const title =
      input.title?.trim() ||
      (rpyPath
        ? defaultTitleFromRpyPath(rpyPath)
        : defaultTitleFromMediaPath(mediaPath!));

    const session: ReplaySession = {
      id: deps.id.generate(),
      rpyPath,
      ibtPath: input.ibtPath?.trim() || null,
      mediaPath,
      trackName: input.trackName?.trim() || null,
      focusCarIdx:
        typeof input.focusCarIdx === "number" && Number.isFinite(input.focusCarIdx)
          ? Math.trunc(input.focusCarIdx)
          : null,
      title,
      durationSec: null,
      status: mediaPath ? "ready" : "draft",
      events: [],
      racePackage: null,
      fullVideoEncodePath: null,
      fullVideoYoutubeId: null,
      fullVideoPrivacy: null,
      fullVideoPublishedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await deps.replaySessions.save(session);
    log.info("Replay session created", {
      sessionId: session.id,
      status: session.status,
      hasMedia: Boolean(session.mediaPath),
      hasIbt: Boolean(session.ibtPath),
      hasRpy: Boolean(session.rpyPath),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return session;
  };
}
