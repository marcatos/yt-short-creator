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
    analyze_clips: stub("Clip analysis"),
    ideate: stub("Ideation"),
    assemble_generate_preview: stub("Generate preview"),
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
  });
}
