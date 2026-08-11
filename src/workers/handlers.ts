import type { RunClipAnalysis } from "@/src/application/run-clip-analysis";
import type {
  AssembleGeneratePreview,
  RunIdeation,
} from "@/src/application/run-ideation";
import type { Logger } from "@/src/ports/logger";
import type { SourceVideoRepository } from "@/src/ports/source-video-repository";
import type { VideoDownloadPort } from "@/src/ports/video-download";

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
    render_short: stub("Render"),
    publish_short: stub("Publish"),
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
  });
}
