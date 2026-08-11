import fs from "node:fs/promises";

import type { ReplaySession } from "@/src/domain/entities";
import type { ClockPort } from "@/src/ports/clock";
import type { Logger } from "@/src/ports/logger";
import type { MediaDurationPort } from "@/src/ports/media-duration";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";

type Dependencies = {
  replaySessions: ReplaySessionRepository;
  mediaDuration: MediaDurationPort;
  clock: ClockPort;
  logger: Logger;
};

export type AttachReplayMedia = (input: {
  sessionId: string;
  mediaPath: string;
}) => Promise<ReplaySession>;

export type AttachReplayIbt = (input: {
  sessionId: string;
  ibtPath: string;
}) => Promise<ReplaySession>;

async function requireSession(
  repo: ReplaySessionRepository,
  sessionId: string,
): Promise<ReplaySession> {
  const session = await repo.getById(sessionId);
  if (!session) {
    throw new Error(`Replay session not found: ${sessionId}`);
  }
  return session;
}

export function createAttachReplayMedia(deps: Dependencies): AttachReplayMedia {
  const log = deps.logger.child({ operation: "attachReplayMedia" });

  return async ({ sessionId, mediaPath }) => {
    const startedAt = performance.now();
    const trimmed = mediaPath.trim();
    if (!trimmed) {
      throw new Error("mediaPath is required");
    }
    await fs.access(trimmed);

    const session = await requireSession(deps.replaySessions, sessionId);
    const durationSec = await deps.mediaDuration.probeDurationSec(trimmed);
    const updated: ReplaySession = {
      ...session,
      mediaPath: trimmed,
      durationSec: durationSec ?? session.durationSec,
      status: session.status === "capturing" ? "ready" : "ready",
      updatedAt: deps.clock.now(),
    };
    await deps.replaySessions.save(updated);
    log.info("Replay media attached", {
      sessionId,
      mediaPath: trimmed,
      durationSec: updated.durationSec,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return updated;
  };
}

.createAttachReplayIbt(deps: {
  replaySessions: ReplaySessionRepository;
  clock: ClockPort;
  logger: Logger;
}): AttachReplayIbt {
  const log = deps.logger.child({ operation: "attachReplayIbt" });

  return async ({ sessionId, ibtPath }) => {
    const startedAt = performance.now();
    const trimmed = ibtPath.trim();
    if (!trimmed) {
      throw new Error("ibtPath is required");
    }
    await fs.access(trimmed);

    const session = await requireSession(deps.replaySessions, sessionId);
    const updated: ReplaySession = {
      ...session,
      ibtPath: trimmed,
      updatedAt: deps.clock.now(),
    };
    await deps.replaySessions.save(updated);
    log.info("Replay IBT attached", {
      sessionId,
      ibtPath: trimmed,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return updated;
  };
}
