import type { RequestReplayCapture } from "@/src/application/request-replay-capture";
import type { RunClipAnalysis } from "@/src/application/run-clip-analysis";
import type {
  AssembleGeneratePreview,
  RunIdeation,
} from "@/src/application/run-ideation";
import type { RunReplayAnalysis } from "@/src/application/run-replay-analysis";
import type { RunReplayDirectorCapture } from "@/src/application/run-replay-director-capture";
import type { BrandPackPort } from "@/src/ports/brand-pack";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { JobRepository } from "@/src/ports/job-repository";
import type { InspectableJobQueue } from "@/src/ports/job-queue";
import type { Logger } from "@/src/ports/logger";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { RenderPort } from "@/src/ports/render";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";
import type { SettingsRepository } from "@/src/ports/settings-repository";
import type { SourceVideoRepository } from "@/src/ports/source-video-repository";
import type { VideoDownloadPort } from "@/src/ports/video-download";
import type { YouTubeAuthPort } from "@/src/ports/youtube-auth";
import type { YouTubeCaptionsPort } from "@/src/ports/youtube-captions";
import type { YouTubeUploadPort } from "@/src/ports/youtube-upload";
import type { FullVideoEncodePort } from "@/src/ports/full-video-encode";
import type { FullVoMixPort } from "@/src/ports/full-vo-mix";
import type { GenerateFullVoiceOvers } from "@/src/application/generate-full-voice-overs";

import { requireNumberPayload, requireStringPayload } from "./handler-utils";
import type { JobHandlerContext, JobHandler, JobHandlers } from "./job-handler-context";
import { createPublishFullReplayHandler } from "./publish-full-replay-handler";
import { createPublishShortHandler } from "./publish-short-handler";
import { createRenderShortHandler } from "./render-short-handler";
import { runStep } from "./run-step";

export type { JobHandlerContext, JobHandler, JobHandlers } from "./job-handler-context";

export type HandlerDeps = {
  logger: Logger;
  sourceVideos: SourceVideoRepository;
  replaySessions: ReplaySessionRepository;
  videoDownload: VideoDownloadPort;
  runClipAnalysis: RunClipAnalysis;
  runReplayAnalysis: RunReplayAnalysis;
  requestReplayCapture: RequestReplayCapture;
  runReplayDirectorCapture: RunReplayDirectorCapture;
  runIdeation: RunIdeation;
  assembleGeneratePreview: AssembleGeneratePreview;
  candidates: CandidateRepository;
  jobs: JobRepository;
  render: RenderPort;
  brandPack: BrandPackPort;
  mediaStore: MediaStorePort;
  queue: InspectableJobQueue;
  settings: SettingsRepository;
  auth: YouTubeAuthPort;
  upload: YouTubeUploadPort;
  captions?: YouTubeCaptionsPort;
  fullVideoEncode: FullVideoEncodePort;
  fullVoMix?: FullVoMixPort;
  generateFullVoiceOvers?: GenerateFullVoiceOvers;
  clock: ClockPort;
};

const stub = (label: string, jobType: string): JobHandler => (ctx) =>
  runStep(ctx, jobType, "run", async () => {
    ctx.setProgress(0, `${label} started`);
    ctx.setProgress(100, `${label} complete`);
  });

function singleStep(
  jobType: string,
  step: string,
  fn: (ctx: JobHandlerContext) => Promise<void>,
): JobHandler {
  return (ctx) => runStep(ctx, jobType, step, () => fn(ctx));
}

export function createHandlers(
  deps: HandlerDeps,
): JobHandlers & { director_capture_replay: JobHandler } {
  const handlerLogger = deps.logger.child({ component: "JobHandlers" });

  return {
    sync_channel: stub("Channel sync", "sync_channel"),
    download_source_video: async (ctx) => {
      const sourceVideoId = requireStringPayload(ctx.payload, "sourceVideoId");
      const video = await deps.sourceVideos.getById(sourceVideoId);
      if (!video) {
        throw new Error(`Source video not found: ${sourceVideoId}`);
      }

      await runStep(ctx, "download_source_video", "download", async () => {
        if (video.localMediaPath) {
          handlerLogger.info("download_source_video skipped", {
            jobId: ctx.jobId,
            sourceVideoId,
            localPath: video.localMediaPath,
          });
          ctx.setProgress(100, `Already downloaded to ${video.localMediaPath}`);
          return;
        }

        handlerLogger.info("download_source_video started", {
          jobId: ctx.jobId,
          sourceVideoId,
          youtubeVideoId: video.youtubeVideoId,
        });
        ctx.setProgress(0, `Downloading ${video.youtubeVideoId}`);
        const localPath = await deps.videoDownload.download(
          video.youtubeVideoId,
          { signal: ctx.signal },
        );
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
      });
    },
    analyze_clips: singleStep("analyze_clips", "run", async (ctx) => {
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
    }),
    analyze_replay: singleStep("analyze_replay", "run", async (ctx) => {
      const sessionId = requireStringPayload(ctx.payload, "sessionId");
      const startedAt = performance.now();
      handlerLogger.info("analyze_replay started", {
        jobId: ctx.jobId,
        sessionId,
      });
      ctx.setProgress(10, "Analyzing iRacing replay");
      const candidates = await deps.runReplayAnalysis({ sessionId });
      ctx.setProgress(100, `Created ${candidates.length} replay candidates`);
      handlerLogger.info("analyze_replay completed", {
        jobId: ctx.jobId,
        sessionId,
        candidateCount: candidates.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
    }),
    capture_replay: singleStep("capture_replay", "capture", async (ctx) => {
      const sessionId = requireStringPayload(ctx.payload, "sessionId");
      const watchDir =
        typeof ctx.payload.watchDir === "string"
          ? ctx.payload.watchDir
          : undefined;
      const timeoutMs =
        typeof ctx.payload.timeoutMs === "number"
          ? ctx.payload.timeoutMs
          : undefined;
      const startedAt = performance.now();
      handlerLogger.info("capture_replay started", {
        jobId: ctx.jobId,
        sessionId,
        watchDir,
        timeoutMs,
      });
      ctx.setProgress(
        5,
        "Opening .rpy in iRacing and starting automatic video capture",
      );
      const session = await deps.requestReplayCapture({
        sessionId,
        watchDir,
        timeoutMs,
      });
      ctx.setProgress(100, `Captured ${session.mediaPath}`);
      handlerLogger.info("capture_replay completed", {
        jobId: ctx.jobId,
        sessionId,
        mediaPath: session.mediaPath,
        durationMs: Math.round(performance.now() - startedAt),
      });
    }),
    director_capture_replay: singleStep(
      "director_capture_replay",
      "capture",
      async (ctx) => {
        const sessionId = requireStringPayload(ctx.payload, "sessionId");
        const startedAt = performance.now();
        handlerLogger.info("director_capture_replay started", {
          jobId: ctx.jobId,
          sessionId,
        });
        ctx.setProgress(
          5,
          "Director mode: seeking incidents/events and recording highlight shots",
        );
        const result = await deps.runReplayDirectorCapture({ sessionId });
        ctx.setProgress(
          100,
          `Directed ${result.candidates.length} highlight candidates from ${result.session.mediaPath}`,
        );
        handlerLogger.info("director_capture_replay completed", {
          jobId: ctx.jobId,
          sessionId,
          mediaPath: result.session.mediaPath,
          candidateCount: result.candidates.length,
          durationMs: Math.round(performance.now() - startedAt),
        });
      },
    ),
    ideate: singleStep("ideate", "run", async (ctx) => {
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
    }),
    // `assembleGeneratePreview` synthesizes TTS and assembles the preview in
    // one atomic call (see src/application/run-ideation.ts). Splitting it
    // into `tts` + `assemble` checkpoints would require an invasive rewrite
    // of that use-case, so v1 uses a single `assemble` checkpoint step.
    assemble_generate_preview: singleStep(
      "assemble_generate_preview",
      "assemble",
      async (ctx) => {
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
    ),
    render_short: createRenderShortHandler(deps),
    publish_short: createPublishShortHandler(deps),
    publish_full_replay: createPublishFullReplayHandler({
      logger: deps.logger,
      replaySessions: deps.replaySessions,
      mediaStore: deps.mediaStore,
      fullVideoEncode: deps.fullVideoEncode,
      fullVoMix: deps.fullVoMix,
      generateFullVoiceOvers: deps.generateFullVoiceOvers,
      settings: deps.settings,
      captions: deps.captions,
      queue: deps.queue,
      auth: deps.auth,
      upload: deps.upload,
      clock: deps.clock,
    }),
  };
}
