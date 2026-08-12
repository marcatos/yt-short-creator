import { describe, expect, it } from "vitest";

import { createAddManualReplayMoment } from "@/src/application/add-manual-replay-moment";
import { createRunReplayAnalysis } from "@/src/application/run-replay-analysis";
import type {
  ReplaySession,
  ShortCandidate,
} from "@/src/domain/entities";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { Logger } from "@/src/ports/logger";
import type { MediaProxyPort } from "@/src/ports/media-proxy";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";
import type { TranscriptionPort } from "@/src/ports/transcription";

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
    racePackage: null,
    fullVideoEncodePath: null,
    fullVideoYoutubeId: null,
    fullVideoPrivacy: null,
    fullVideoPublishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function fakeMediaStore(): MediaStorePort {
  return {
    sourcePath: () => "",
    renderPath: () => "",
    audioPath: () => "",
    brollPath: () => "",
    replayAnalysisDir: (sessionId) => `C:/media/replays/${sessionId}`,
    fullReplayEncodePath: (sessionId) =>
      `C:/media/replays/${sessionId}/full-youtube.mp4`,
    listBroll: async () => [],
    ensureDirs: async () => undefined,
  };
}

function fakeMediaProxy(): MediaProxyPort {
  return {
    async ensureProxy() {
      return {
        proxyVideoPath: "C:/media/proxy.mp4",
        audioPath: "C:/media/audio.mp3",
        framesDir: "C:/media/frames",
        frames: [
          { timeMs: 0, path: "C:/media/frames/frame_000001.jpg" },
          { timeMs: 2_000, path: "C:/media/frames/frame_000002.jpg" },
        ],
        durationSec: 180,
        reused: false,
      };
    },
  };
}

function fakeTranscription(): TranscriptionPort {
  return {
    async transcribe() {
      return {
        text: "engine noise",
        language: "en",
        segments: [{ startMs: 0, endMs: 2_000, text: "engine noise" }],
      };
    },
  };
}

function tenWindows() {
  return Array.from({ length: 10 }, (_, index) => {
    const startMs = 10_000 + index * 12_000;
    return {
      startMs,
      endMs: startMs + 15_000,
      title: `Momento ${index + 1}`,
      description: `Descrizione ${index + 1}`,
      tags: ["racing"],
      score: 0.9 - index * 0.02,
      hookReason: `Hook ${index + 1}`,
      segments:
        index === 0
          ? [
              { startMs: 10_000, endMs: 18_000 },
              { startMs: 40_000, endMs: 47_000 },
            ]
          : [],
    };
  });
}

describe("runReplayAnalysis", () => {
  it("runs AV analysis and stores racePackage with >=10 shorts", async () => {
    const sessions = new MemoryReplaySessions(
      baseSession({ ibtPath: "C:/telemetry/race.ibt" }),
    );
    const candidates = new MemoryCandidates();
    let visionCalls = 0;
    let packageCalls = 0;

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
      mediaProxy: fakeMediaProxy(),
      transcription: fakeTranscription(),
      mediaStore: fakeMediaStore(),
      llm: {
        async complete(input) {
          if (input.userParts?.length) {
            visionCalls += 1;
            return JSON.stringify({
              moments: [
                {
                  timeMs: 0,
                  summary: "Focus car on grid",
                  involvingFocusCar: true,
                  interest: 0.7,
                },
              ],
            });
          }
          packageCalls += 1;
          return JSON.stringify({
            racePackage: {
              focusCarHint: "pi livery",
              transcript: "Partenza tesa, poi battaglia al T1.",
              timeline: [
                {
                  startMs: 0,
                  endMs: 20_000,
                  summary: "Start",
                  involvingFocusCar: true,
                },
              ],
              fullVideo: {
                title: "Imola: battaglia da brividi",
                description: "Gara completa S.Marcato 42",
                tags: ["iRacing", "Imola"],
              },
              audioTranscript: "engine noise",
            },
            windows: tenWindows(),
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
    expect(proposed.length).toBeGreaterThanOrEqual(10);
    expect(proposed[0]?.origin).toBe("replay");
    expect(visionCalls).toBeGreaterThan(0);
    expect(packageCalls).toBe(1);
    expect(sessions.session.racePackage?.fullVideo.title).toContain("Imola");
    expect(sessions.session.status).toBe("ready");
    expect(
      proposed.some(
        (candidate) =>
          "segments" in candidate.provenance &&
          Array.isArray(candidate.provenance.segments) &&
          (candidate.provenance.segments?.length ?? 0) >= 2,
      ),
    ).toBe(true);
  });

  it("still proposes shorts when whisper fails", async () => {
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
      mediaProxy: fakeMediaProxy(),
      transcription: {
        async transcribe() {
          throw new Error("whisper down");
        },
      },
      mediaStore: fakeMediaStore(),
      llm: {
        async complete(input) {
          if (input.userParts?.length) {
            return JSON.stringify({ moments: [] });
          }
          return JSON.stringify({
            racePackage: {
              focusCarHint: "pi",
              transcript: "Narrativa vision-only",
              timeline: [],
              fullVideo: {
                title: "Titolo",
                description: "Desc",
                tags: ["iRacing"],
              },
              audioTranscript: "",
            },
            windows: tenWindows(),
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
    expect(proposed).toHaveLength(10);
    expect(sessions.session.racePackage?.transcript).toContain("vision");
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

describe("createReplaySession media-only", () => {
  it("allows OBS sessions without rpy", async () => {
    const { createCreateReplaySession } = await import(
      "@/src/application/create-replay-session"
    );
    const sessions = new MemoryReplaySessions(baseSession());
    const create = createCreateReplaySession({
      replaySessions: {
        async save(session) {
          sessions.session = session;
        },
        async getById() {
          return sessions.session;
        },
        async list() {
          return [sessions.session];
        },
      },
      id: { generate: () => "obs-1" },
      clock: { now: () => now },
      logger: createLogger(),
    });

    const session = await create({
      mediaPath: "C:/Videos/race.mkv",
      title: "OBS race",
    });
    expect(session.rpyPath).toBeNull();
    expect(session.mediaPath).toContain("race.mkv");
    expect(session.status).toBe("ready");
  });
});
