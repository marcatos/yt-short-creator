import { describe, expect, it } from "vitest";

import type { RenderJob, ShortCandidate, SourceVideo } from "@/src/domain/entities";
import type { Logger } from "@/src/ports/logger";
import { createHandlers } from "@/src/workers/handlers";

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

describe("render_short handler", () => {
  it("renders the candidate, records the output, and transitions it to ready", async () => {
    let candidate: ShortCandidate = {
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
    const jobs: RenderJob[] = [];
    let renderInput: Record<string, unknown> | undefined;
    const handlers = createHandlers({
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
      videoDownload: { async download() { return ""; } },
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
          jobs.push(job);
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
          renderInput = input;
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
          return "publish-job-1";
        },
        async getProgress() {
          return null;
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

    const progress: number[] = [];
    await handlers.render_short({
      jobId: "render-job-1",
      payload: { candidateId: candidate.id },
      setProgress(pct) {
        progress.push(pct);
      },
    });

    expect(renderInput).toMatchObject({
      candidateId: candidate.id,
      sourceMediaPath: source.localMediaPath,
      outputPath: "media/renders/candidate-1.mp4",
      logoPath: "brand/logo.png",
      accentColor: "#E10600",
      startMs: 1_000,
      endMs: 2_000,
    });
    expect(candidate.status).toBe("ready");
    expect(candidate.renderOutputPath).toBe("media/renders/candidate-1.mp4");
    expect(jobs.at(-1)).toMatchObject({
      id: "render-job-1",
      candidateId: candidate.id,
      status: "succeeded",
      outputPath: "media/renders/candidate-1.mp4",
      progressPct: 100,
    });
    expect(progress).toEqual([5, 20, 100]);
  });
});
