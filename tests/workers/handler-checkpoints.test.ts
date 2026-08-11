import { describe, expect, it } from "vitest";

import { JobCancelledError, JobPausedError } from "@/src/domain/queue-control";
import type { JobRecord } from "@/src/adapters/jobs/job-record";
import type {
  RenderJob,
  ShortCandidate,
  SourceVideo,
} from "@/src/domain/entities";
import type { Logger } from "@/src/ports/logger";
import { createHandlers } from "@/src/workers/handlers";
import type { JobHandlerContext } from "@/src/workers/job-handler-context";

const now = new Date("2026-08-11T10:00:00.000Z");

function logger(): Logger {
  const instance: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child: () => instance,
  };
  return instance;
}

function baseCandidate(): ShortCandidate {
  return {
    id: "candidate-1",
    origin: "clip",
    status: "rendering",
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

function makeCtx(overrides: Partial<JobHandlerContext> = {}): JobHandlerContext {
  return {
    jobId: "job-1",
    payload: {},
    checkpoint: null,
    setProgress() {},
    async saveCheckpoint() {},
    signal: new AbortController().signal,
    shouldPause: () => false,
    throwIfPausedOrCancelled() {},
    ...overrides,
  };
}

function makeHandlers(options: {
  candidate: ShortCandidate;
  onCandidateSave?: (candidate: ShortCandidate) => void;
  onRenderJobSave?: (job: RenderJob) => void;
  onEnqueue?: () => void;
  queueJobs?: JobRecord[];
  onUpload?: () => void;
  renderCalled: { value: boolean };
}) {
  const { candidate: initialCandidate } = options;
  let candidate = initialCandidate;
  const source: SourceVideo = {
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

  return createHandlers({
    logger: logger(),
    sourceVideos: {
      async save() {},
      async getById(id) {
        return id === source.id ? source : null;
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
        return "";
      },
    },
    runClipAnalysis: async () => [],
    runReplayAnalysis: async () => [],
    requestReplayCapture: async ({ sessionId }) => {
      throw new Error(`unused capture ${sessionId}`);
    },
    runIdeation: async () => [],
    assembleGeneratePreview: async () => candidate,
    candidates: {
      async save(value) {
        candidate = value;
        options.onCandidateSave?.(value);
      },
      async getById(id) {
        return id === candidate.id ? candidate : null;
      },
      async list() {
        return [candidate];
      },
    },
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
        options.onRenderJobSave?.(job);
      },
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
      async render(input) {
        options.renderCalled.value = true;
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
      renderPath: () => "media/renders/candidate-1.mp4",
      audioPath: () => "",
      brollPath: () => "",
      listBroll: async () => [],
      ensureDirs: async () => {},
    },
    queue: {
      async enqueue() {
        options.onEnqueue?.();
        return "publish-job-1";
      },
      async getProgress() {
        return null;
      },
      listJobs() {
        return options.queueJobs ?? [];
      },
    },
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
          expiresAt: new Date(now.getTime() + 3_600_000),
        };
      },
      async saveTokens() {},
    },
    upload: {
      async upload() {
        options.onUpload?.();
        return { youtubeVideoId: "youtube-short-1" };
      },
    },
    clock: { now: () => now },
  });
}

describe("render_short handler checkpoints", () => {
  it("skips prepare and render when checkpoint is already at render", async () => {
    const renderCalled = { value: false };
    const savedCheckpoints: string[] = [];
    const handlers = makeHandlers({
      candidate: baseCandidate(),
      renderCalled,
    });

    await handlers.render_short(
      makeCtx({
        payload: { candidateId: "candidate-1" },
        checkpoint: { step: "render" },
        async saveCheckpoint(step) {
          savedCheckpoints.push(step);
        },
      }),
    );

    expect(renderCalled.value).toBe(false);
    expect(savedCheckpoints).toEqual(["enqueue_publish"]);
  });

  it("enqueues publish only once resumed past the render step", async () => {
    const renderCalled = { value: false };
    let enqueued = 0;
    const handlers = makeHandlers({
      candidate: baseCandidate(),
      renderCalled,
      onEnqueue: () => {
        enqueued += 1;
      },
    });

    await handlers.render_short(
      makeCtx({
        payload: { candidateId: "candidate-1" },
        checkpoint: { step: "render" },
      }),
    );

    expect(enqueued).toBe(1);
    expect(renderCalled.value).toBe(false);
  });

  it("pauses after saving the render checkpoint and enqueues once on resume", async () => {
    const renderCalled = { value: false };
    let enqueued = 0;
    let pauseRequested = false;
    const handlers = makeHandlers({
      candidate: baseCandidate(),
      renderCalled,
      onEnqueue: () => {
        enqueued += 1;
      },
    });

    await expect(
      handlers.render_short(
        makeCtx({
          payload: { candidateId: "candidate-1" },
          async saveCheckpoint(step) {
            if (step === "render") {
              pauseRequested = true;
            }
          },
          throwIfPausedOrCancelled() {
            if (pauseRequested) {
              throw new JobPausedError();
            }
          },
        }),
      ),
    ).rejects.toThrow(JobPausedError);

    expect(renderCalled.value).toBe(true);
    expect(enqueued).toBe(0);

    await handlers.render_short(
      makeCtx({
        payload: { candidateId: "candidate-1" },
        checkpoint: { step: "render" },
      }),
    );

    expect(enqueued).toBe(1);
  });

  it("skips enqueue when a publish job already exists for the candidate", async () => {
    const renderCalled = { value: false };
    let enqueued = 0;
    const savedCheckpoints: string[] = [];
    const handlers = makeHandlers({
      candidate: baseCandidate(),
      renderCalled,
      queueJobs: [
        {
          id: "publish-job-existing",
          type: "publish_short",
          payload: { candidateId: "candidate-1" },
          status: "succeeded",
          position: 1,
          progressPct: 100,
          progressMessage: "Published",
          checkpoint: { step: "upload" },
          error: null,
          createdAt: now,
          startedAt: now,
          finishedAt: now,
          updatedAt: now,
        },
      ],
      onEnqueue: () => {
        enqueued += 1;
      },
    });

    await handlers.render_short(
      makeCtx({
        payload: { candidateId: "candidate-1" },
        checkpoint: { step: "render" },
        async saveCheckpoint(step) {
          savedCheckpoints.push(step);
        },
      }),
    );

    expect(enqueued).toBe(0);
    expect(savedCheckpoints).toEqual(["enqueue_publish"]);
  });

  it("re-throws pause errors without marking the candidate or render job failed", async () => {
    const renderCalled = { value: false };
    let candidateSaved: ShortCandidate | undefined;
    let renderJobSaved: RenderJob | undefined;
    const handlers = makeHandlers({
      candidate: baseCandidate(),
      renderCalled,
      onCandidateSave: (candidate) => {
        candidateSaved = candidate;
      },
      onRenderJobSave: (job) => {
        renderJobSaved = job;
      },
    });

    let pauseAfterPrepare = false;
    await expect(
      handlers.render_short(
        makeCtx({
          payload: { candidateId: "candidate-1" },
          checkpoint: null,
          throwIfPausedOrCancelled() {
            if (pauseAfterPrepare) {
              throw new JobPausedError();
            }
          },
          async saveCheckpoint() {
            pauseAfterPrepare = true;
          },
        }),
      ),
    ).rejects.toThrow(JobPausedError);

    expect(renderJobSaved?.status).not.toBe("failed");
    expect(candidateSaved?.status).not.toBe("failed");
  });

  it("fails the candidate and render job when cancelled mid-render", async () => {
    const renderCalled = { value: false };
    let candidateSaved: ShortCandidate | undefined;
    let renderJobSaved: RenderJob | undefined;
    const handlers = makeHandlers({
      candidate: baseCandidate(),
      renderCalled,
      onCandidateSave: (candidate) => {
        candidateSaved = candidate;
      },
      onRenderJobSave: (job) => {
        renderJobSaved = job;
      },
    });

    let cancelAfterPrepare = false;
    await expect(
      handlers.render_short(
        makeCtx({
          payload: { candidateId: "candidate-1" },
          checkpoint: null,
          throwIfPausedOrCancelled() {
            if (cancelAfterPrepare) {
              throw new JobCancelledError();
            }
          },
          async saveCheckpoint() {
            cancelAfterPrepare = true;
          },
        }),
      ),
    ).rejects.toThrow(JobCancelledError);

    expect(candidateSaved?.status).toBe("failed");
    expect(renderJobSaved?.status).toBe("failed");
  });
});

describe("publish_short handler checkpoints", () => {
  it("checkpoints upload without uploading an already published candidate", async () => {
    const renderCalled = { value: false };
    let uploads = 0;
    const savedCheckpoints: string[] = [];
    const handlers = makeHandlers({
      candidate: { ...baseCandidate(), status: "published" },
      renderCalled,
      onUpload: () => {
        uploads += 1;
      },
    });

    await handlers.publish_short(
      makeCtx({
        payload: { candidateId: "candidate-1" },
        async saveCheckpoint(step) {
          savedCheckpoints.push(step);
        },
      }),
    );

    expect(uploads).toBe(0);
    expect(savedCheckpoints).toEqual(["upload"]);
  });

  it("re-throws pause errors without marking the candidate or publish job failed", async () => {
    const renderCalled = { value: false };
    let candidateSaved: ShortCandidate | undefined;
    const handlers = makeHandlers({
      candidate: {
        ...baseCandidate(),
        status: "publishing",
        renderOutputPath: "media/renders/candidate-1.mp4",
      },
      renderCalled,
      onCandidateSave: (candidate) => {
        candidateSaved = candidate;
      },
    });

    let pauseAfterPrepare = false;
    await expect(
      handlers.publish_short(
        makeCtx({
          payload: { candidateId: "candidate-1" },
          checkpoint: null,
          throwIfPausedOrCancelled() {
            if (pauseAfterPrepare) {
              throw new JobPausedError();
            }
          },
          async saveCheckpoint() {
            pauseAfterPrepare = true;
          },
        }),
      ),
    ).rejects.toThrow(JobPausedError);

    expect(candidateSaved?.status).not.toBe("failed");
  });

  it("fails the candidate and publish job when cancelled mid-upload", async () => {
    const renderCalled = { value: false };
    let candidateSaved: ShortCandidate | undefined;
    const handlers = makeHandlers({
      candidate: {
        ...baseCandidate(),
        status: "publishing",
        renderOutputPath: "media/renders/candidate-1.mp4",
      },
      renderCalled,
      onCandidateSave: (candidate) => {
        candidateSaved = candidate;
      },
    });

    let cancelAfterPrepare = false;
    await expect(
      handlers.publish_short(
        makeCtx({
          payload: { candidateId: "candidate-1" },
          checkpoint: null,
          throwIfPausedOrCancelled() {
            if (cancelAfterPrepare) {
              throw new JobCancelledError();
            }
          },
          async saveCheckpoint() {
            cancelAfterPrepare = true;
          },
        }),
      ),
    ).rejects.toThrow(JobCancelledError);

    expect(candidateSaved?.status).toBe("failed");
  });
});

describe("download_source_video handler checkpoints", () => {
  it("skips the download call when the source video already has local media", async () => {
    let downloadCalled = false;
    const video: SourceVideo = {
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
    const handlers = createHandlers({
      logger: logger(),
      sourceVideos: {
        async save() {},
        async getById() {
          return video;
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
          downloadCalled = true;
          return "media/downloaded.mp4";
        },
      },
      runClipAnalysis: async () => [],
      runReplayAnalysis: async () => [],
      requestReplayCapture: async ({ sessionId }) => {
        throw new Error(`unused capture ${sessionId}`);
      },
      runIdeation: async () => [],
      assembleGeneratePreview: async () => {
        throw new Error("unused");
      },
      candidates: {
        async save() {},
        async getById() {
          return null;
        },
        async list() {
          return [];
        },
      },
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
            logoStackedPath: "",
            storyTemplatePath: "",
            accentHex: "#E10600",
          };
        },
      },
      mediaStore: {
        sourcePath: () => "",
        renderPath: () => "",
        audioPath: () => "",
        brollPath: () => "",
        listBroll: async () => [],
        ensureDirs: async () => {},
      },
      queue: {
        async enqueue() {
          return "";
        },
        async getProgress() {
          return null;
        },
        listJobs() {
          return [];
        },
      },
      settings: {
        async get() {
          return {
            brandRoot: "",
            logLevel: "INFO",
            defaultPrivacy: "unlisted",
            videoEncoderPreference: "auto_igpu",
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
          return null;
        },
        async saveTokens() {},
      },
      upload: {
        async upload() {
          throw new Error("unused");
        },
      },
      clock: { now: () => now },
    });

    const savedCheckpoints: string[] = [];
    await handlers.download_source_video(
      makeCtx({
        payload: { sourceVideoId: "source-1" },
        async saveCheckpoint(step) {
          savedCheckpoints.push(step);
        },
      }),
    );

    expect(downloadCalled).toBe(false);
    expect(savedCheckpoints).toEqual(["download"]);
  });

  it("skips entirely when the checkpoint already recorded the download step", async () => {
    let downloadCalled = false;
    let getByIdCalled = false;
    const video: SourceVideo = {
      id: "source-1",
      channelId: "channel-1",
      youtubeVideoId: "youtube-1",
      title: "Source",
      durationSec: 60,
      localMediaPath: null,
      analyticsSnapshot: null,
      publishedAt: now,
      syncedAt: now,
    };
    const handlers = createHandlers({
      logger: logger(),
      sourceVideos: {
        async save() {},
        async getById() {
          getByIdCalled = true;
          return video;
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
          downloadCalled = true;
          return "media/downloaded.mp4";
        },
      },
      runClipAnalysis: async () => [],
      runReplayAnalysis: async () => [],
      requestReplayCapture: async ({ sessionId }) => {
        throw new Error(`unused capture ${sessionId}`);
      },
      runIdeation: async () => [],
      assembleGeneratePreview: async () => {
        throw new Error("unused");
      },
      candidates: {
        async save() {},
        async getById() {
          return null;
        },
        async list() {
          return [];
        },
      },
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
            logoStackedPath: "",
            storyTemplatePath: "",
            accentHex: "#E10600",
          };
        },
      },
      mediaStore: {
        sourcePath: () => "",
        renderPath: () => "",
        audioPath: () => "",
        brollPath: () => "",
        listBroll: async () => [],
        ensureDirs: async () => {},
      },
      queue: {
        async enqueue() {
          return "";
        },
        async getProgress() {
          return null;
        },
        listJobs() {
          return [];
        },
      },
      settings: {
        async get() {
          return {
            brandRoot: "",
            logLevel: "INFO",
            defaultPrivacy: "unlisted",
            videoEncoderPreference: "auto_igpu",
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
          return null;
        },
        async saveTokens() {},
      },
      upload: {
        async upload() {
          throw new Error("unused");
        },
      },
      clock: { now: () => now },
    });

    await handlers.download_source_video(
      makeCtx({
        payload: { sourceVideoId: "source-1" },
        checkpoint: { step: "download" },
      }),
    );

    expect(getByIdCalled).toBe(true);
    expect(downloadCalled).toBe(false);
  });
});
