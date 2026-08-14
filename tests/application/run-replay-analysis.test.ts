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

  async listByIds(ids: string[]): Promise<ShortCandidate[]> {
    return this.items.filter((candidate) => ids.includes(candidate.id));
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

function fakeRaceHudExtractor(
  timeline: Array<Record<string, unknown>> = [],
) {
  return {
    async extract() {
      return timeline as never;
    },
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

function tenShortCandidates() {
  return Array.from({ length: 10 }, (_, index) => {
    const startMs = 10_000 + index * 12_000;
    return {
      shortScore: 0.9 - index * 0.02,
      startMs,
      endMs: startMs + 15_000,
      hook: `Hook ${index + 1}`,
      story: `Story ${index + 1}`,
      payoff: `Payoff ${index + 1}`,
      recommendedTitleIt: `Momento ${index + 1}`,
      recommendedTitleEn: `Moment ${index + 1}`,
      requiresLocalizedRender: false,
      segments:
        index === 0
          ? [
              { startMs: 10_000, endMs: 18_000 },
              { startMs: 40_000, endMs: 47_000 },
            ]
          : undefined,
      tags: ["racing"],
      descriptionIt: `Descrizione ${index + 1}`,
      descriptionEn: `Description ${index + 1}`,
    };
  });
}

function raceAnalysisLlmFixture(overrides: Record<string, unknown> = {}) {
  return {
    focusCarHint: "pi livery",
    context: {
      simulator: "iRacing",
      track: "Imola",
      car: "GR86",
      durationSec: 180,
    },
    results: {
      qualiResult: null,
      startPosition: null,
      finishPosition: null,
      fieldSize: null,
      positionsGained: null,
    },
    recurringRivals: [],
    events: [],
    timeline: [
      {
        startMs: 0,
        endMs: 20_000,
        summary: "Start",
        involvingFocusCar: true,
      },
    ],
    storylines: [
      {
        kind: "main",
        summary: "Battaglia al T1",
        whyWatch: "Battaglia ravvicinata al T1",
      },
    ],
    mainStoryline: "Partenza tesa, poi battaglia al T1",
    whyWatch: "C'è una battaglia ravvicinata al T1",
    potentialHooks: ["Battaglia T1"],
    shortCandidates: tenShortCandidates(),
    narrativeIt: "Partenza tesa, poi battaglia al T1.",
    audioTranscript: "engine noise",
    ...overrides,
  };
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
      raceHudExtractor: fakeRaceHudExtractor(),
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
            raceAnalysis: raceAnalysisLlmFixture({
              narrativeIt: "Partenza tesa, poi battaglia al T1.",
              potentialHooks: ["Imola: battaglia da brividi"],
            }),
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
    expect(sessions.session.raceAnalysis?.context.track).toBe("Imola");
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
      raceHudExtractor: fakeRaceHudExtractor(),
      llm: {
        async complete(input) {
          if (input.userParts?.length) {
            return JSON.stringify({ moments: [] });
          }
          return JSON.stringify({
            raceAnalysis: raceAnalysisLlmFixture({
              narrativeIt: "Narrativa vision-only",
              mainStoryline: "Vision-only story",
            }),
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
    expect(sessions.session.raceAnalysis?.narrativeIt).toContain("vision");
    expect(sessions.session.racePackage?.transcript).toContain("vision");
  });

  it("uses HUD focus card for subject and fills verified results", async () => {
    const sessions = new MemoryReplaySessions(baseSession());
    const candidates = new MemoryCandidates();
    let faseAUser = "";

    const run = createRunReplayAnalysis({
      replaySessions: sessions,
      candidates,
      ibtTelemetry: {
        async parse() {
          return { events: [], trackName: null };
        },
      },
      mediaProxy: fakeMediaProxy(),
      transcription: fakeTranscription(),
      mediaStore: fakeMediaStore(),
      raceHudExtractor: fakeRaceHudExtractor([
        {
          timeMs: 0,
          session: {
            sessionType: "RACE",
            status: "REPLAY",
            trackName: "Oschersleben",
            lap: 1,
            sessionTime: "0:10",
            flag: "GREEN",
          },
          focus: {
            carNumber: 7,
            driverName: "Simone Marcato",
            position: 5,
            fieldSize: 19,
            lastLap: null,
            bestLap: null,
            gapToLeader: "+2.0s",
            deltaBest: null,
            fuelPct: null,
            sectors: null,
          },
          battle: {
            rows: [
              {
                role: "ahead",
                carNumber: 4,
                driverName: "Yoan",
                gapSec: -0.5,
              },
              {
                role: "focus",
                carNumber: 7,
                driverName: "Simone Marcato",
                gapSec: 0,
              },
              {
                role: "behind",
                carNumber: 5,
                driverName: "Kike",
                gapSec: 0.2,
              },
            ],
          },
          standings: {
            rows: [
              {
                position: 5,
                carNumber: 7,
                driverName: "Simone Marcato",
                gapText: "+2.0s",
                positionDelta: null,
              },
            ],
          },
          battleCallout: null,
          fieldTicker: null,
          confidence: "verified",
        },
        {
          timeMs: 120_000,
          session: {
            sessionType: "RACE",
            status: "REPLAY",
            trackName: "Oschersleben",
            lap: 8,
            sessionTime: "12:00",
            flag: "GREEN",
          },
          focus: {
            carNumber: 7,
            driverName: "Simone Marcato",
            position: 2,
            fieldSize: 19,
            lastLap: "1:41.143",
            bestLap: null,
            gapToLeader: "+0.86s",
            deltaBest: null,
            fuelPct: null,
            sectors: null,
          },
          battle: {
            rows: [
              {
                role: "ahead",
                carNumber: 4,
                driverName: "Yoan",
                gapSec: -0.86,
              },
              {
                role: "focus",
                carNumber: 7,
                driverName: "Simone Marcato",
                gapSec: 0,
              },
            ],
          },
          standings: {
            rows: [
              {
                position: 1,
                carNumber: 4,
                driverName: "Yoan",
                gapText: "LEADER",
                positionDelta: null,
              },
              {
                position: 2,
                carNumber: 7,
                driverName: "Simone Marcato",
                gapText: "+0.86s",
                positionDelta: null,
              },
            ],
          },
          battleCallout: {
            contestedPosition: 2,
            rows: [
              {
                carNumber: 7,
                driverName: "Simone Marcato",
                gapSec: 0,
                note: null,
              },
              {
                carNumber: 5,
                driverName: "Kike",
                gapSec: 0.2,
                note: null,
              },
            ],
          },
          fieldTicker: null,
          confidence: "verified",
        },
      ]),
      llm: {
        async complete(input) {
          if (input.userParts?.length) {
            return JSON.stringify({ moments: [] });
          }
          faseAUser = input.user;
          return JSON.stringify({
            raceAnalysis: raceAnalysisLlmFixture({
              results: {
                qualiResult: null,
                startPosition: null,
                finishPosition: null,
                fieldSize: null,
                positionsGained: null,
              },
            }),
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

    await run({ sessionId: "session-1" });

    expect(faseAUser).toContain("=== HUD overlay (verified when present) ===");
    expect(faseAUser).toContain("#7");
    expect(sessions.session.raceAnalysis?.focusCarHint).toContain("#7");
    expect(sessions.session.raceAnalysis?.results.startPosition).toBe(5);
    expect(sessions.session.raceAnalysis?.results.finishPosition).toBe(2);
    expect(sessions.session.raceAnalysis?.results.fieldSize).toBe(19);
    expect(sessions.session.raceAnalysis?.hudTimeline).toHaveLength(2);
    expect(
      sessions.session.raceAnalysis?.events.some(
        (event) => event.kind === "battle" && event.confidence === "verified",
      ),
    ).toBe(true);
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
