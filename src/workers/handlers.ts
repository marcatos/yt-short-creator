import type { RunClipAnalysis } from "@/src/application/run-clip-analysis";
import type {
  AssembleGeneratePreview,
  RunIdeation,
} from "@/src/application/run-ideation";
import { applyCandidateEvent } from "@/src/domain/approval";
import type { RenderJob, ShortCandidate } from "@/src/domain/entities";
import type { BrandPackPort } from "@/src/ports/brand-pack";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { JobRepository } from "@/src/ports/job-repository";
import type { JobQueuePort } from "@/src/ports/job-queue";
import type { Logger } from "@/src/ports/logger";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { RenderInput, RenderPort } from "@/src/ports/render";
import type { SettingsRepository } from "@/src/ports/settings-repository";
import type { SourceVideoRepository } from "@/src/ports/source-video-repository";
import type { VideoDownloadPort } from "@/src/ports/video-download";
import type { YouTubeAuthPort } from "@/src/ports/youtube-auth";
import type { YouTubeUploadPort } from "@/src/ports/youtube-upload";

import { createPublishShortHandler } from "./publish-short-handler";

export type JobHandlerContext = {
  jobId: string;
  payload: Record<string, unknown>;
  setProgress(pct: number, message: string): void;
};

export type JobHandler = (ctx: JobHandlerContext) => Promise<void>;

export type JobHandlers = Record<string, JobHandler>;

type HandlerDeps = {
  logger: Logger;
  sourceVideos: SourceVideoRepository;
  videoDownload: VideoDownloadPort;
  runClipAnalysis: RunClipAnalysis;
  runIdeation: RunIdeation;
  assembleGeneratePreview: AssembleGeneratePreview;
  candidates: CandidateRepository;
  jobs: JobRepository;
  render: RenderPort;
  brandPack: BrandPackPort;
  mediaStore: MediaStorePort;
  queue: JobQueuePort;
  settings: SettingsRepository;
  auth: YouTubeAuthPort;
  upload: YouTubeUploadPort;
  clock: ClockPort;
};

const stub = (label: string): JobHandler => async (ctx) => {
  ctx.setProgress(0, `${label} started`);
  ctx.setProgress(100, `${label} complete`);
};

function requireStringPayload(
  payload: Record<string, unknown>,
  key: string,
): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Job payload missing required string field: ${key}`);
  }
  return value;
}

function requireNumberPayload(
  payload: Record<string, unknown>,
  key: string,
): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Job payload missing required number field: ${key}`);
  }
  return value;
}

async function renderInputForCandidate(
  candidate: ShortCandidate,
  deps: HandlerDeps,
): Promise<RenderInput> {
  const brand = await deps.brandPack.resolve();
  const common = {
    candidateId: candidate.id,
    origin: candidate.origin,
    outputPath: deps.mediaStore.renderPath(candidate.id),
    logoPath: brand.logoStackedPath,
    accentColor: brand.accentHex,
  };

  if ("sourceVideoId" in candidate.provenance) {
    const source = await deps.sourceVideos.getById(
      candidate.provenance.sourceVideoId,
    );
    if (!source?.localMediaPath) {
      throw new Error(
        `Local source media not found for candidate: ${candidate.id}`,
      );
    }
    return {
      ...common,
      origin: "clip",
      sourceMediaPath: source.localMediaPath,
      startMs: candidate.provenance.startMs,
      endMs: candidate.provenance.endMs,
      crop: candidate.provenance.crop,
    };
  }

  return {
    ...common,
    origin: "generate",
    sourceMediaPath: candidate.provenance.timeline[0]?.asset ?? "",
    voiceAssetPath: candidate.provenance.voiceAssetPath,
    timeline: candidate.provenance.timeline,
  };
}

export function createHandlers(deps: HandlerDeps): JobHandlers {
  const handlerLogger = deps.logger.child({ component: "JobHandlers" });

  return {
    sync_channel: stub("Channel sync"),
    download_source_video: async (ctx) => {
      const sourceVideoId = requireStringPayload(ctx.payload, "sourceVideoId");
      const video = await deps.sourceVideos.getById(sourceVideoId);
      if (!video) {
        throw new Error(`Source video not found: ${sourceVideoId}`);
      }

      handlerLogger.info("download_source_video started", {
        jobId: ctx.jobId,
        sourceVideoId,
        youtubeVideoId: video.youtubeVideoId,
      });

      ctx.setProgress(0, `Downloading ${video.youtubeVideoId}`);
      const localPath = await deps.videoDownload.download(video.youtubeVideoId);
      await deps.sourceVideos.save({
        ...video,
        localMediaPath: localPath,
      });

      ctx.setProgress(100, `Downloaded to ${localPath}`);
      handlerLogger.info("download_source_video completed", {
        jobId: ctx.jobId,
        sourceVideoId,
        youtubeVideoId: video.youtubeVideoId,
        localPath,
      });
    },
    analyze_clips: async (ctx) => {
      const sourceVideoId = requireStringPayload(ctx.payload, "sourceVideoId");
      const startedAt = performance.now();
      handlerLogger.info("analyze_clips started", {
        jobId: ctx.jobId,
        sourceVideoId,
      });
      ctx.setProgress(10, "Analyzing source video");
      const candidates = await deps.runClipAnalysis({ sourceVideoId });
      ctx.setProgress(100, `Created ${candidates.length} clip candidates`);
      handlerLogger.info("analyze_clips completed", {
        jobId: ctx.jobId,
        sourceVideoId,
        candidateCount: candidates.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
    },
    ideate: async (ctx) => {
      const channelId = requireStringPayload(ctx.payload, "channelId");
      const count = requireNumberPayload(ctx.payload, "count");
      const startedAt = performance.now();
      handlerLogger.info("ideate started", {
        jobId: ctx.jobId,
        channelId,
        requestedCount: count,
      });
      ctx.setProgress(10, "Generating Shorts ideas");
      const candidates = await deps.runIdeation({ channelId, count });
      ctx.setProgress(100, `Created ${candidates.length} generated candidates`);
      handlerLogger.info("ideate completed", {
        jobId: ctx.jobId,
        channelId,
        candidateCount: candidates.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
    },
    assemble_generate_preview: async (ctx) => {
      const candidateId = requireStringPayload(ctx.payload, "candidateId");
      const startedAt = performance.now();
      handlerLogger.info("assemble_generate_preview started", {
        jobId: ctx.jobId,
        candidateId,
      });
      ctx.setProgress(10, "Synthesizing voice and assembling preview");
      const candidate = await deps.assembleGeneratePreview({ candidateId });
      const timeline = "timeline" in candidate.provenance
        ? candidate.provenance.timeline
        : [];
      ctx.setProgress(100, `Preview assembled with ${timeline.length} B-roll assets`);
      handlerLogger.info("assemble_generate_preview completed", {
        jobId: ctx.jobId,
        candidateId,
        timelineAssetCount: timeline.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
    },
    render_short: async (ctx) => {
      const candidateId = requireStringPayload(ctx.payload, "candidateId");
      const startedAt = performance.now();
      let candidate = await deps.candidates.getById(candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }
      if (candidate.status === "approved") {
        candidate = applyCandidateEvent(candidate, { type: "enqueue_render" });
        await deps.candidates.save(candidate);
      } else if (candidate.status !== "rendering") {
        throw new Error(
          `Candidate cannot render in status "${candidate.status}"`,
        );
      }
      const existingJob =
        await deps.jobs.getRenderJobByCandidateId(candidateId);
      const renderJobId = existingJob?.id ?? ctx.jobId;
      const createdAt = existingJob?.createdAt ?? deps.clock.now();

      const saveJob = async (
        status: RenderJob["status"],
        outputPath: string | null,
        progressPct: number,
        message: string,
      ) => {
        await deps.jobs.saveRenderJob({
          id: renderJobId,
          candidateId,
          status,
          outputPath,
          progressPct,
          message,
          createdAt,
          updatedAt: deps.clock.now(),
        });
      };

      handlerLogger.info("render_short started", {
        jobId: ctx.jobId,
        candidateId,
        origin: candidate.origin,
      });
      ctx.setProgress(5, "Preparing brand assets");
      await saveJob("running", null, 5, "Preparing brand assets");

      try {
        const input = await renderInputForCandidate(candidate, deps);
        ctx.setProgress(20, "Rendering 9:16 video");
        await saveJob("running", null, 20, "Rendering 9:16 video");
        const result = await deps.render.render(input);

        candidate = {
          ...applyCandidateEvent(candidate, { type: "render_succeeded" }),
          renderOutputPath: result.outputPath,
        };
        await deps.candidates.save(candidate);
        await saveJob(
          "succeeded",
          result.outputPath,
          100,
          "Render complete",
        );
        const publishJobId = await deps.queue.enqueue({
          type: "publish_short",
          payload: { candidateId },
        });
        ctx.setProgress(100, `Rendered to ${result.outputPath}`);
        handlerLogger.info("render_short completed", {
          jobId: ctx.jobId,
          candidateId,
          outputPath: result.outputPath,
          publishJobId,
          durationMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        if (candidate.status === "rendering") {
          await deps.candidates.save(
            applyCandidateEvent(candidate, { type: "render_failed" }),
          );
        }
        await saveJob("failed", null, 100, "Render failed");
        handlerLogger.error("render_short failed", {
          jobId: ctx.jobId,
          candidateId,
          durationMs: Math.round(performance.now() - startedAt),
          error: error instanceof Error ? error.stack : String(error),
        });
        throw error;
      }
    },
    publish_short: createPublishShortHandler(deps),
  };
}

export function createStubHandlers(): JobHandlers {
  return createHandlers({
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
      child() {
        return this;
      },
    },
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
        return "";
      },
    },
    async runClipAnalysis() {
      return [];
    },
    async runIdeation() {
      return [];
    },
    async assembleGeneratePreview({ candidateId }) {
      throw new Error(`Generate candidate not found: ${candidateId}`);
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
      sourcePath() {
        return "";
      },
      renderPath() {
        return "";
      },
      audioPath() {
        return "";
      },
      brollPath() {
        return "";
      },
      async listBroll() {
        return [];
      },
      async ensureDirs() {},
    },
    queue: {
      async enqueue() {
        return "";
      },
      async getProgress() {
        return null;
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
        throw new Error("YouTube auth is unavailable");
      },
      async refreshAccessToken() {
        throw new Error("YouTube auth is unavailable");
      },
      async getStoredTokens() {
        return null;
      },
      async saveTokens() {},
    },
    upload: {
      async upload() {
        throw new Error("YouTube upload is unavailable");
      },
    },
    clock: {
      now() {
        return new Date();
      },
    },
  });
}
