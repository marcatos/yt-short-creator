import { describe, expect, it } from "vitest";

import { createApproveCandidate } from "@/src/application/approve-candidate";
import { createRunIdeation } from "@/src/application/run-ideation";
import type {
  GenerationBrief,
  PublishJob,
  RenderJob,
  ShortCandidate,
} from "@/src/domain/entities";
import type { Logger } from "@/src/ports/logger";
import { createHandlers } from "@/src/workers/handlers";

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

describe("pipeline smoke path", () => {
  it("generates, approves, renders, publishes, and finishes published using only fakes", async () => {
    const candidates = new Map<string, ShortCandidate>();
    const briefs = new Map<string, GenerationBrief>();
    const renderJobs: RenderJob[] = [];
    const publishJobs: PublishJob[] = [];
    const queued: Array<{
      id: string;
      type: string;
      payload: Record<string, unknown>;
    }> = [];
    const uploads: Array<Record<string, unknown>> = [];
    const ids = ["brief-1", "candidate-1"];
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
      async enqueue(job: {
        type: string;
        payload: Record<string, unknown>;
      }) {
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
    const mediaStore = {
      sourcePath: () => "media/source.mp4",
      renderPath: (id: string) => `media/renders/${id}.mp4`,
      audioPath: (id: string) => `media/audio/${id}.mp3`,
      brollPath: (filename: string) => `media/broll/${filename}`,
      listBroll: async () => ["race.mp4"],
      ensureDirs: async () => {},
    };

    const runIdeation = createRunIdeation({
      llm: {
        async complete() {
          return JSON.stringify({
            ideas: [
              {
                hook: "Brake later, exit faster",
                script: "Use one clean braking input and release progressively.",
                title: "The faster corner exit",
                description: "A concise racing technique.",
                tags: ["racing", "driving"],
                score: 0.94,
                voiceProfile: "alloy",
                brollPlan: ["Onboard corner"],
              },
            ],
          });
        },
      },
      tts: {
        async synthesize() {
          return { durationMs: 5_000 };
        },
      },
      mediaStore,
      briefs: {
        async save(brief) {
          briefs.set(brief.id, brief);
        },
        async getById(id) {
          return briefs.get(id) ?? null;
        },
        async listByChannelId(channelId) {
          return [...briefs.values()].filter(
            (brief) => brief.channelId === channelId,
          );
        },
      },
      candidates: candidateRepository,
      id: { generate: () => ids.shift() ?? "unexpected-id" },
      clock: { now: () => now },
      logger,
    });
    const [generated] = await runIdeation({
      channelId: "channel-1",
      count: 1,
    });

    expect(generated.status).toBe("proposed");

    const approveCandidate = createApproveCandidate({
      candidates: candidateRepository,
      queue,
      logger,
    });
    await approveCandidate({ candidateId: generated.id });

    expect(candidates.get(generated.id)?.status).toBe("approved");
    expect(queued[0]).toMatchObject({
      type: "render_short",
      payload: { candidateId: generated.id },
    });

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
      videoDownload: {
        async download() {
          return "media/source.mp4";
        },
      },
      runClipAnalysis: async () => [],
      runReplayAnalysis: async () => [],
      requestReplayCapture: async ({ sessionId }) => {
        throw new Error(`unused capture ${sessionId}`);
      },
      runIdeation,
      assembleGeneratePreview: async ({ candidateId }) => {
        const candidate = candidates.get(candidateId);
        if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
        return candidate;
      },
      candidates: candidateRepository,
      replaySessions: {
        async save() {},
        async getById() {
          return null;
        },
        async list() {
          return [];
        },
      },
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
      mediaStore,
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
            expiresAt: new Date("2026-08-11T11:00:00.000Z"),
          };
        },
        async saveTokens() {},
      },
      upload: {
        async upload(input) {
          uploads.push(input);
          return { youtubeVideoId: "youtube-short-1" };
        },
      },
      clock: { now: () => now },
    });

    const renderJob = queued.shift();
    expect(renderJob?.type).toBe("render_short");
    await handlers.render_short({
      jobId: renderJob?.id ?? "missing-render-job",
      payload: renderJob?.payload ?? {},
      checkpoint: null,
      setProgress() {},
      async saveCheckpoint() {},
      signal: new AbortController().signal,
      shouldPause: () => false,
      throwIfPausedOrCancelled() {},
    });

    expect(candidates.get(generated.id)?.status).toBe("ready");
    const publishJob = queued.shift();
    expect(publishJob?.type).toBe("publish_short");
    await handlers.publish_short({
      jobId: publishJob?.id ?? "missing-publish-job",
      payload: publishJob?.payload ?? {},
      checkpoint: null,
      setProgress() {},
      async saveCheckpoint() {},
      signal: new AbortController().signal,
      shouldPause: () => false,
      throwIfPausedOrCancelled() {},
    });

    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      filePath: "media/renders/candidate-1.mp4",
      privacy: "unlisted",
    });
    expect(candidates.get(generated.id)?.status).toBe("published");
    expect(publishJobs.at(-1)).toMatchObject({
      status: "succeeded",
      youtubeVideoId: "youtube-short-1",
    });
  });
});
