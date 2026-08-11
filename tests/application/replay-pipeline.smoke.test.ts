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
      llm: {
        async complete() {
          return JSON.stringify({
            windows: [
              {
                startMs: 5_000,
                endMs: 20_000,
                title: "Monza dive",
                description: "Late brake pass",
                tags: ["iRacing"],
                score: 0.91,
                hookReason: "Late dive",
              },
            ],
          });
        },
      },
      id: { generate: () => "candidate-replay-1" },
      clock: { now: () => now },
      logger,
    });

    const [proposed] = await runReplayAnalysis({ sessionId: "session-1" });
    expect(proposed.origin).toBe("replay");

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
      runIdeation: async () => [],
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
        listBroll: async () => [],
        ensureDirs: async () => {},
      },
      queue,
      settings: {
        async get() {
          return {
            brandRoot: "brand",
            logLevel: "INFO",
            defaultPrivacy: "unlisted",
            videoEncoderPreference: "libx264",
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
