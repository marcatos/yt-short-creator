import type { ReplayEvent, ShortCandidate } from "@/src/domain/entities";
import { windowAroundEvent } from "@/src/domain/replay";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { IdPort } from "@/src/ports/id";
import type { Logger } from "@/src/ports/logger";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";

type Dependencies = {
  replaySessions: ReplaySessionRepository;
  candidates: CandidateRepository;
  id: IdPort;
  clock: ClockPort;
  logger: Logger;
};

export type AddManualReplayMoment = (input: {
  sessionId: string;
  startMs: number;
  endMs: number;
  title?: string;
  hookReason?: string;
}) => Promise<ShortCandidate>;

export function createAddManualReplayMoment(
  deps: Dependencies,
): AddManualReplayMoment {
  const log = deps.logger.child({ operation: "addManualReplayMoment" });

  return async (input) => {
    const startedAt = performance.now();
    const session = await deps.replaySessions.getById(input.sessionId);
    if (!session) {
      throw new Error(`Replay session not found: ${input.sessionId}`);
    }
    if (!session.mediaPath) {
      throw new Error(
        "Replay session has no media. Attach an MP4 before marking moments.",
      );
    }
    if (
      !Number.isFinite(input.startMs) ||
      !Number.isFinite(input.endMs) ||
      input.endMs <= input.startMs
    ) {
      throw new Error("endMs must be greater than startMs");
    }

    const durationMs = input.endMs - input.startMs;
    if (durationMs < 8_000 || durationMs > 60_000) {
      throw new Error("Manual moment must be between 8 and 60 seconds");
    }

    if (
      session.durationSec !== null &&
      input.endMs > session.durationSec * 1_000
    ) {
      throw new Error("Moment exceeds media duration");
    }

    const event: ReplayEvent = {
      id: deps.id.generate(),
      type: "manual",
      startMs: Math.floor(input.startMs),
      endMs: Math.floor(input.endMs),
      score: 1,
      title: input.title?.trim() || `Manual moment — ${session.title}`,
      hookReason:
        input.hookReason?.trim() || "Operator-selected replay moment",
    };

    const window = windowAroundEvent(event, session.durationSec);
    // Manual marks use exact operator window; windowAroundEvent only clamps.
    const startMs = Math.floor(input.startMs);
    const endMs = Math.floor(input.endMs);
    const now = deps.clock.now();
    const candidate: ShortCandidate = {
      id: deps.id.generate(),
      origin: "replay",
      status: "proposed",
      title: event.title!,
      description: [event.hookReason, "#Shorts", "#iRacing"].join("\n"),
      tags: ["Shorts", "iRacing", "manual"],
      score: 1,
      provenance: {
        replaySessionId: session.id,
        startMs,
        endMs,
        hookReason: event.hookReason,
        eventType: "manual",
        crop: { mode: "center_vertical", focusX: 0.5 },
      },
      renderOutputPath: null,
      scheduledAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await deps.candidates.save(candidate);
    await deps.replaySessions.save({
      ...session,
      events: [...session.events, { ...event, startMs, endMs }],
      updatedAt: now,
    });

    log.info("Manual replay moment added", {
      sessionId: session.id,
      candidateId: candidate.id,
      startMs,
      endMs,
      clampedHint: window,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return candidate;
  };
}
