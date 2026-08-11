import type { ReplaySession } from "@/src/domain/entities";
import { defaultTitleFromRpyPath } from "@/src/domain/replay";
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
  rpyPath: string;
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
    const rpyPath = input.rpyPath.trim();
    if (!rpyPath) {
      throw new Error("rpyPath is required");
    }

    const now = deps.clock.now();
    const session: ReplaySession = {
      id: deps.id.generate(),
      rpyPath,
      ibtPath: input.ibtPath?.trim() || null,
      mediaPath: input.mediaPath?.trim() || null,
      trackName: input.trackName?.trim() || null,
      focusCarIdx:
        typeof input.focusCarIdx === "number" && Number.isFinite(input.focusCarIdx)
          ? Math.trunc(input.focusCarIdx)
          : null,
      title: input.title?.trim() || defaultTitleFromRpyPath(rpyPath),
      durationSec: null,
      status: input.mediaPath?.trim() ? "ready" : "draft",
      events: [],
      createdAt: now,
      updatedAt: now,
    };

    await deps.replaySessions.save(session);
    log.info("Replay session created", {
      sessionId: session.id,
      status: session.status,
      hasMedia: Boolean(session.mediaPath),
      hasIbt: Boolean(session.ibtPath),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return session;
  };
}
