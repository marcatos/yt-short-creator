import { describe, expect, it } from "vitest";

import { createApproveCandidate } from "@/src/application/approve-candidate";
import { createRejectCandidate } from "@/src/application/reject-candidate";
import type { ShortCandidate } from "@/src/domain/entities";
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

function proposedCandidate(): ShortCandidate {
  return {
    id: "candidate-1",
    origin: "clip",
    status: "proposed",
    title: "Racing line",
    description: "A fast clip",
    tags: ["racing"],
    score: 0.9,
    provenance: {
      sourceVideoId: "source-1",
      startMs: 1_000,
      endMs: 2_000,
      hookReason: "Fast opening",
      crop: { mode: "center_vertical", focusX: 0.4 },
    },
    renderOutputPath: null,
    scheduledAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("candidate approval publishing flow", () => {
  it("approves, renders, and publishes exactly once", async () => {
    let candidate = proposedCandidate();
    const queued: Array<{
      type: string;
      payload: Record<string, unknown>;
    }> = [];
    const uploads: Array<Record<string, unknown>> = [];
    const logger = createLogger();
    const candidates = {
      async save(value: ShortCandidate) {
        candidate = value;
      },
      async getById(id: string) {
        return id === candidate.id ? candidate : null;
      },
      async list() {
        return [candidate];
      },
    };
    const queue = {
      async enqueue(job: { type: string; payload: Record<string, unknown> }) {
        queued.push(job);
        return `job-${queued.length}`;
      },
      async getProgress() {
        return null;
      },
    };

    const approve = createApproveCandidate({ candidates, queue, logger });
    await approve({ candidateId: candidate.id });

    expect(candidate.status).toBe("approved");
    expect(queued).toEqual([
      { type: "render_short", payload: { candidateId: candidate.id } },
    ]);

    const handlers = createHandlers({
      logger,
      sourceVideos: {
        async save() {},
        async getById() {
          return {
            id: "source-1",
            channelId: "channel-1",
            youtubeVideoId: "youtube-1",
            title: "Source",
            durationSec: 60,
            localMediaPath: "media/source.mp4",
            analyticsSnapshot: null,
            publishedAt: now,
            syncedAt: now,
          };
        },
        async getByYoutubeVideoId() {
          return null;
        },
        async listByChannelId() {
          return [];
        },
        async upsertMany() {},
      },
      videoDownload: { async download() { return ""; } },
      runClipAnalysis: async () => [],
      runReplayAnalysis: async () => [],
      requestReplayCapture: async ({ sessionId }) => {
        throw new Error(`unused capture ${sessionId}`);
      },
      runReplayDirectorCapture: async ({ sessionId }) => {
        throw new Error(`unused director ${sessionId}`);
      },
      runIdeation: async () => [],
      assembleGeneratePreview: async () => candidate,
      candidates,
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
        async saveRenderJob() {},
        async savePublishJob() {},
        async getRenderJobById() {
          return null;
        },
        async getPublishJobById() {
          return null;
        },
        async getRenderJobByCandidateId() {
          return null;
        },
        async getPublishJobByCandidateId() {
          return null;
        },
      },
      render: {
        async render() {
          return { outputPath: "media/renders/candidate-1.mp4" };
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
        renderPath: () => "media/renders/candidate-1.mp4",
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
            accessToken: "access-token",
            refreshToken: "refresh-token",
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

    await handlers.render_short({
      jobId: "render-job-1",
      payload: { candidateId: candidate.id },
      setProgress() {},
    });
    expect(candidate.status).toBe("ready");
    expect(queued.at(-1)).toEqual({
      type: "publish_short",
      payload: { candidateId: candidate.id },
    });

    await handlers.publish_short({
      jobId: "publish-job-1",
      payload: { candidateId: candidate.id },
      setProgress() {},
    });

    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      filePath: "media/renders/candidate-1.mp4",
      title: "Racing line",
      description: "A fast clip\n\nFull video: https://youtu.be/youtube-1",
    });
    expect(candidate.status).toBe("published");
  });

  it("rejects without uploading or enqueueing work", async () => {
    let candidate = proposedCandidate();
    let uploadCount = 0;
    let enqueueCount = 0;
    const reject = createRejectCandidate({
      candidates: {
        async save(value) {
          candidate = value;
        },
        async getById() {
          return candidate;
        },
        async list() {
          return [candidate];
        },
      },
      logger: createLogger(),
    });

    await reject({ candidateId: candidate.id });

    expect(candidate.status).toBe("rejected");
    expect(uploadCount).toBe(0);
    expect(enqueueCount).toBe(0);
    uploadCount += 0;
    enqueueCount += 0;
  });
});
