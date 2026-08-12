import { describe, expect, it } from "vitest";

import type {
  RenderJob,
  ShortCandidate,
  SourceVideo,
} from "@/src/domain/entities";
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
  it("renders IT and EN independently then enqueues their localized publishes", async () => {
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
      voiceOvers: [
        {
          language: "it",
          script: "Spingi fino al traguardo.",
          title: "Spinta all'ultimo giro",
          description: "L'ultimo giro decisivo.",
          voiceProfile: "coral",
          audioPath: "media/voice/candidate-1-it.mp3",
          words: [{ text: "Spingi", startMs: 0, endMs: 400 }],
          srtPath: "media/voice/candidate-1-it.srt",
          assPath: "media/voice/candidate-1-it.ass",
          scriptHash: "script-hash-it",
        },
        {
          language: "en",
          script: "Push to the finish.",
          title: "Final-lap push",
          description: "The decisive final lap.",
          voiceProfile: "coral",
          audioPath: "media/voice/candidate-1-en.mp3",
          words: [{ text: "Push", startMs: 0, endMs: 400 }],
          srtPath: "media/voice/candidate-1-en.srt",
          assPath: "media/voice/candidate-1-en.ass",
          scriptHash: "script-hash",
        },
      ],
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
    const renderInputs: Array<Record<string, unknown>> = [];
    const enqueued: Array<Record<string, unknown>> = [];
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
          renderInputs.push(input);
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
        voRenderPath: (_candidateId, language) =>
          `media/renders/candidate-1/vo-${language}.mp4`,
        audioPath: () => "",
        brollPath: () => "",
        replayAnalysisDir: () => "",
        fullReplayEncodePath: () => "",
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
      queue: {
        async enqueue(job) {
          enqueued.push(job);
          return `job-${enqueued.length}`;
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
            brandRoot: "brand",
            logLevel: "INFO",
            defaultPrivacy: "unlisted",
            videoEncoderPreference: "libx264",
            brandVoiceProfile: "coral",
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
      payload: { candidateId: candidate.id, language: "en" },
      checkpoint: null,
      setProgress(pct) {
        progress.push(pct);
      },
      async saveCheckpoint() {},
      signal: new AbortController().signal,
      shouldPause: () => false,
      throwIfPausedOrCancelled() {},
    });

    await handlers.render_short({
      jobId: "render-job-2",
      payload: { candidateId: candidate.id, language: "it" },
      checkpoint: null,
      setProgress(pct) {
        progress.push(pct);
      },
      async saveCheckpoint() {},
      signal: new AbortController().signal,
      shouldPause: () => false,
      throwIfPausedOrCancelled() {},
    });

    expect(renderInputs[0]).toMatchObject({
      candidateId: candidate.id,
      sourceMediaPath: source.localMediaPath,
      outputPath: "media/renders/candidate-1/vo-en.mp4",
      logoPath: "brand/logo.png",
      accentColor: "#E10600",
      startMs: 1_000,
      endMs: 2_000,
      voiceAssetPath: "media/voice/candidate-1-en.mp3",
      assPath: "media/voice/candidate-1-en.ass",
      burnInCaptions: true,
      voiceDuckDb: -12,
    });
    expect(renderInputs[1]).toMatchObject({
      outputPath: "media/renders/candidate-1/vo-it.mp4",
      voiceAssetPath: "media/voice/candidate-1-it.mp3",
      assPath: "media/voice/candidate-1-it.ass",
    });
    expect(candidate.status).toBe("ready");
    expect(candidate.renderOutputPath).toBeNull();
    expect(candidate.voiceOvers).toEqual([
      expect.objectContaining({
        language: "it",
        renderOutputPath: "media/renders/candidate-1/vo-it.mp4",
      }),
      expect.objectContaining({
        language: "en",
        renderOutputPath: "media/renders/candidate-1/vo-en.mp4",
      }),
    ]);
    expect(jobs.at(-1)).toMatchObject({
      id: "render-job-2",
      candidateId: candidate.id,
      status: "succeeded",
      outputPath: "media/renders/candidate-1/vo-it.mp4",
      progressPct: 100,
    });
    expect(enqueued).toEqual([
      {
        type: "publish_short",
        payload: {
          candidateId: candidate.id,
          language: "it",
          filePath: "media/renders/candidate-1/vo-it.mp4",
          srtPath: "media/voice/candidate-1-it.srt",
          title: "Spinta all'ultimo giro",
          description: "L'ultimo giro decisivo.",
        },
      },
      {
        type: "publish_short",
        payload: {
          candidateId: candidate.id,
          language: "en",
          filePath: "media/renders/candidate-1/vo-en.mp4",
          srtPath: "media/voice/candidate-1-en.srt",
          title: "Final-lap push",
          description: "The decisive final lap.",
        },
      },
    ]);
    expect(progress).toEqual([5, 20, 100, 5, 20, 100]);
  });
});
