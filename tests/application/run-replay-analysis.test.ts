import { describe, expect, it } from "vitest";

import { createAddManualReplayMoment } from "@/src/application/add-manual-replay-moment";
import { createRunReplayAnalysis } from "@/src/application/run-replay-analysis";
import type {
  ReplaySession,
  ShortCandidate,
} from "@/src/domain/entities";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { Logger } from "@/src/ports/logger";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";

const now = new Date("2026-08-11T10:00:00.000Z");

function createLogger(): Logger {
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child: () => logger,
  };
  return logger;
}

class MemoryReplaySessions implements ReplaySessionRepository {
  constructor(public session: ReplaySession) {}

  async save(session: ReplaySession): Promise<void> {
    this.session = session;
  }

  async getById(id: string): Promise<ReplaySession | null> {
    return this.session.id === id ? this.session : null;
  }

  async list(): Promise<ReplaySession[]> {
    return [this.session];
  }
}

class MemoryCandidates implements CandidateRepository {
  readonly items: ShortCandidate[] = [];

  async save(candidate: ShortCandidate): Promise<void> {
    this.items.push(candidate);
  }

  async getById(id: string): Promise<ShortCandidate | null> {
    return this.items.find((candidate) => candidate.id === id) ?? null;
  }

  async list(): Promise<ShortCandidate[]> {
    return this.items;
  }
}

function baseSession(overrides: Partial<ReplaySession> = {}): ReplaySession {
  return {
    id: "session-1",
    rpyPath: "C:/replays/race.rpy",
    ibtPath: null,
    mediaPath: "C:/videos/race.mp4",
    trackName: "Imola",
    focusCarIdx: 0,
    title: "Imola race",
    durationSec: 180,
    status: "ready",
    events: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("runReplayAnalysis", () => {
  it("uses telemetry events when IBT yields strong moments", async () => {
    const sessions = new MemoryReplaySessions(
      baseSession({ ibtPath: "C:/telemetry/race.ibt" }),
    );
    const candidates = new MemoryCandidates();
    const run = createRunReplayAnalysis({
      replaySessions: sessions,
      candidates,
      ibtTelemetry: {
        async parse() {
          return {
            trackName: "Imola",
            events: [
              {
                id: "e1",
                type: "incident",
                startMs: 45_000,
                endMs: 46_000,
                score: 0.9,
                title: "Spin at T2",
                hookReason: "Sudden slowdown",
              },
            ],
          };
        },
      },
      llm: {
        async complete() {
          throw new Error("LLM should not be called");
        },
      },
      id: {
        generate: (() => {
          let n = 0;
          return () => `id-${++n}`;
        })(),
      },
      clock: { now: () => now },
      logger: createLogger(),
    });

    const proposed = await run({ sessionId: "session-1" });
    expect(proposed).toHaveLength(1);
    expect(proposed[0]?.origin).toBe("replay");
    expect(proposed[0]?.provenance).toMatchObject({
      replaySessionId: "session-1",
      eventType: "incident",
    });
    expect(sessions.session.status).toBe("ready");
  });

  it("falls back to LLM when telemetry is empty", async () => {
    const sessions = new MemoryReplaySessions(baseSession());
    const candidates = new MemoryCandidates();
    const run = createRunReplayAnalysis({
      replaySessions: sessions,
      candidates,
      ibtTelemetry: {
        async parse() {
          return { events: [], trackName: null };
        },
      },
      llm: {
        async complete() {
          return JSON.stringify({
            windows: [
              {
                startMs: 10_000,
                endMs: 25_000,
                title: "Overtake",
                description: "Close pass",
                tags: ["racing"],
                score: 0.8,
                hookReason: "Door-to-door",
              },
            ],
          });
        },
      },
      id: {
        generate: (() => {
          let n = 0;
          return () => `id-${++n}`;
        })(),
      },
      clock: { now: () => now },
      logger: createLogger(),
    });

    const proposed = await run({ sessionId: "session-1" });
    expect(proposed).toHaveLength(1);
    expect(proposed[0]?.provenance).toMatchObject({
      eventType: "llm_moment",
      startMs: 10_000,
      endMs: 25_000,
    });
  });
});

describe("addManualReplayMoment", () => {
  it("creates a proposed replay candidate for an operator mark", async () => {
    const sessions = new MemoryReplaySessions(baseSession());
    const candidates = new MemoryCandidates();
    const add = createAddManualReplayMoment({
      replaySessions: sessions,
      candidates,
      id: {
        generate: (() => {
          let n = 0;
          return () => `manual-${++n}`;
        })(),
      },
      clock: { now: () => now },
      logger: createLogger(),
    });

    const candidate = await add({
      sessionId: "session-1",
      startMs: 12_000,
      endMs: 28_000,
      title: "My divebomb",
    });

    expect(candidate.origin).toBe("replay");
    expect(candidate.provenance).toMatchObject({
      eventType: "manual",
      startMs: 12_000,
      endMs: 28_000,
    });
    expect(sessions.session.events).toHaveLength(1);
  });
});
