import { describe, expect, it } from "vitest";

import { createApproveCandidate } from "@/src/application/approve-candidate";
import { createRunReplayAnalysis } from "@/src/application/run-replay-analysis";
import type {
  PublishJob,
  RenderJob,
  ReplaySession,
  ShortCandidate,
} from "@/src/domain/entities";
import type { Logger } from "@/src/ports/logger";
import { createHandlers } from "@/src/workers/handlers";

const now = new Date("2026-08-11T12:00:00.000Z");

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

describe("replay pipeline smoke", () => {
  it("analyzes a replay, approves, renders, and publishes", async () => {
    const sessions = new Map<string, ReplaySession>();
    sessions.set("session-1", {
      id: "session-1",
      rpyPath: "C:/replays/race.rpy",
      ibtPath: null,
      mediaPath: "media/replay.mp4",
      trackName: "Monza",
      focusCarIdx: 0,
      title: "Monza race",
      durationSec: 120,
      status: "ready",
      events: [],
      racePackage: null,
      fullVideoEncodePath: null,
      fullVideoYoutubeId: null,
      fullVideoPrivacy: null,
      fullVideoPublishedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const candidates = new Map<string, ShortCandidate>();
    const renderJobs: RenderJob[] = [];
    const publishJobs: PublishJob[] = [];
    const queued: Array<{
      id: string;
      type: string;
      payload: Record<string, unknown>;
    }> = [];
    const logger = createLogger();
    const candidateRepository = {
      async save(candidate: ShortCandidate) {
        candidates.set(candidate.id, candidate);
      },
      async getById(id: string) {
        return candidates.get(id) ?? null;
      },
      async list() {
        return [...candidates.values()];
      },
    };
    const queue = {
      async enqueue(job: { type: string; payload: Record<string, unknown> }) {
        const id = `job-${queued.length + 1}`;
        queued.push({ id, ...job });
        return id;
      },
      async getProgress() {
        return null;
      },
      listJobs() {
        return [];
      },
    };

    let idCounter = 0;
    const shortCandidates = Array.from({ length: 10 }, (_, index) => {
      const startMs = 5_000 + index * 10_000;
      return {
        shortScore: 0.91 - index * 0.01,
        startMs,
        endMs: startMs + 15_000,
        hook: "Late dive",
        story: "Late brake pass",
        payoff: "Overtake completes",
        recommendedTitleIt: index === 0 ? "Monza dive" : `Moment ${index + 1}`,
        recommendedTitleEn: index === 0 ? "Monza dive" : `Moment ${index + 1}`,
        requiresLocalizedRender: false,
        tags: ["iRacing"],
        descriptionIt: "Late brake pass",
        descriptionEn: "Late brake pass",
      };
    });

    const runReplayAnalysis = createRunReplayAnalysis({
      replaySessions: {
        async save(session) {
          sessions.set(session.id, session);
        },
        async getById(id) {
          return sessions.get(id) ?? null;
        },
        async list() {
          return [...sessions.values()];
        },
      },
      candidates: candidateRepository,
      ibtTelemetry: {
        async parse() {
          return { events: [], trackName: null };
        },
      },
      mediaProxy: {
        async ensureProxy() {
          return {
            proxyVideoPath: "media/proxy.mp4",
            audioPath: "media/audio.mp3",
            framesDir: "media/frames",
            frames: [{ timeMs: 0, path: "media/frames/a.jpg" }],
            durationSec: 120,
            reused: true,
          };
        },
      },
      transcription: {
        async transcribe() {
          return { text: "", language: null, segments: [] };
        },
      },
      mediaStore: {
        sourcePath: () => "",
        renderPath: (id) => `media/renders/${id}.mp4`,
        audioPath: () => "",
        brollPath: () => "",
        replayAnalysisDir: () => "media/replays/session-1",
        fullReplayEncodePath: () => "media/replays/session-1/full-youtube.mp4",
        listBroll: async () => [],
        ensureDirs: async () => {},
      },
      raceHudExtractor: {
        async extract() {
          return [];
        },
      },
      llm: {
        async complete(input) {
          if (input.userParts?.length) {
            return JSON.stringify({
              moments: [
                {
                  timeMs: 0,
                  summary: "Focus car",
                  involvingFocusCar: true,
                  interest: 0.8,
                },
              ],
            });
          }
          return JSON.stringify({
            raceAnalysis: {
              focusCarHint: "pi",
              context: {
                simulator: "iRacing",
                track: "Monza",
                car: null,
                durationSec: 120,
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
              timeline: [],
              storylines: [
                {
                  kind: "main",
                  summary: "Gara a Monza",
                  whyWatch: "Late dive at Monza",
                },
              ],
              mainStoryline: "Gara a Monza",
              whyWatch: "Late dive at Monza",
              potentialHooks: ["Monza dive"],
              shortCandidates,
              narrativeIt: "Gara a Monza",
              audioTranscript: "",
            },
          });
        },
      },
      id: {
        generate: () => {
          idCounter += 1;
          return `id-${idCounter}`;
        },
      },
      clock: { now: () => now },
      logger,
    });

    const proposedList = await runReplayAnalysis({ sessionId: "session-1" });
    const proposed = proposedList[0]!;
    expect(proposed.origin).toBe("replay");
    expect(proposedList.length).toBeGreaterThanOrEqual(10);

    const approveCandidate = createApproveCandidate({
      candidates: candidateRepository,
      queue,
      logger,
    });
    await approveCandidate({ candidateId: proposed.id });

    const handlers = createHandlers({
      logger,
      sourceVideos: {
        async save() {},
        async getById() {
          return null;
        },
        async getByYoutubeVideoId() {
          return null;
        },
        async listByChannelId() {
          return [];
        },
        async upsertMany() {},
        async deleteByIds() {},
      },
      replaySessions: {
        async save(session) {
          sessions.set(session.id, session);
        },
        async getById(id) {
          return sessions.get(id) ?? null;
        },
        async list() {
          return [...sessions.values()];
        },
      },
      videoDownload: {
        async download() {
          return "";
        },
      },
      runClipAnalysis: async () => [],
      runReplayAnalysis,
      requestReplayCapture: async ({ sessionId }) => {
        const session = sessions.get(sessionId);
        if (!session) throw new Error("missing");
        return session;
      },
      runReplayDirectorCapture: async ({ sessionId }) => {
        const session = sessions.get(sessionId);
        if (!session) throw new Error("missing");
        return { session, candidates: [] };
      },
      runIdeation: async () => [],
      runMatchProposeShorts: async () => ({
        candidates: [],
        successes: 0,
        fillCount: 0,
      }),
      assembleGeneratePreview: async ({ candidateId }) => {
        const candidate = candidates.get(candidateId);
        if (!candidate) throw new Error("missing");
        return candidate;
      },
      candidates: candidateRepository,
      jobs: {
        async saveRenderJob(job) {
          renderJobs.push(job);
        },
        async savePublishJob(job) {
          publishJobs.push(job);
        },
        async getRenderJobById(id) {
          return renderJobs.find((job) => job.id === id) ?? null;
        },
        async getPublishJobById(id) {
          return publishJobs.find((job) => job.id === id) ?? null;
        },
        async getRenderJobByCandidateId(candidateId) {
          return (
            renderJobs.find((job) => job.candidateId === candidateId) ?? null
          );
        },
        async getPublishJobByCandidateId(candidateId) {
          return (
            publishJobs.find((job) => job.candidateId === candidateId) ?? null
          );
        },
    async listPublishJobsByCandidateIds() {
      return [];
    },
      },
      render: {
        async render(input) {
          expect(input.origin).toBe("replay");
          expect(input.sourceMediaPath).toBe("media/replay.mp4");
          return { outputPath: input.outputPath };
        },
      },
      brandPack: {
        async resolve() {
          return {
            tokens: {
              colors: { carbon: "#08080A", ice: "#F4F7FA" },
              racingColors: { rossoCorsa: "#E10600" },
            },
            logoStackedPath: "brand/logo.png",
            storyTemplatePath: "brand/story.png",
            accentHex: "#E10600",
          };
        },
      },
      mediaStore: {
        sourcePath: () => "",
        renderPath: (id) => `media/renders/${id}.mp4`,
        audioPath: () => "",
        brollPath: () => "",
        replayAnalysisDir: () => "media/replays/session-1",
        fullReplayEncodePath: () => "media/replays/session-1/full-youtube.mp4",
        listBroll: async () => [],
        ensureDirs: async () => {},
      },
      fullVideoEncode: {
        async encode(input) {
          return {
            outputPath: input.outputPath,
            reused: true,
            width: 2560,
            height: 1440,
            fps: 60,
            videoBitrateMbps: 20,
            encoderLabel: "test",
            durationMs: 1,
          };
        },
      },
      queue,
      settings: {
        async get() {
          return {
            brandRoot: "brand",
            logLevel: "INFO",
            defaultPrivacy: "unlisted",
            videoEncoderPreference: "libx264",
            brandVoiceProfile: "coral",
    italianVoiceProfile: "ash",
            shortsBurnInCaptions: true,
            fullBurnInCaptions: false,
            voiceDuckDb: -12,
            enableVoiceOverPipeline: true,
          };
        },
        async save() {},
      },
      auth: {
        async getAuthorizationUrl() {
          return "";
        },
        async exchangeCode() {
          throw new Error("unused");
        },
        async refreshAccessToken() {
          throw new Error("unused");
        },
        async getStoredTokens() {
          return {
            accessToken: "fake-access-token",
            refreshToken: "fake-refresh-token",
            expiresAt: new Date("2026-08-11T13:00:00.000Z"),
          };
        },
        async saveTokens() {},
      },
      upload: {
        async upload() {
          return { youtubeVideoId: "yt-replay-1" };
        },
      },
      clock: { now: () => now },
    });

    const renderJob = queued.shift();
    await handlers.render_short({
      jobId: renderJob?.id ?? "render",
      payload: renderJob?.payload ?? {},
      checkpoint: null,
      setProgress() {},
      async saveCheckpoint() {},
      signal: new AbortController().signal,
      shouldPause: () => false,
      throwIfPausedOrCancelled() {},
    });
    expect(candidates.get(proposed.id)?.status).toBe("ready");

    const publishJob = queued.shift();
    await handlers.publish_short({
      jobId: publishJob?.id ?? "publish",
      payload: publishJob?.payload ?? {},
      checkpoint: null,
      setProgress() {},
      async saveCheckpoint() {},
      signal: new AbortController().signal,
      shouldPause: () => false,
      throwIfPausedOrCancelled() {},
    });
    expect(candidates.get(proposed.id)?.status).toBe("published");
  });
});
