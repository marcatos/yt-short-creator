import path from "node:path";

import { createDb, type DbConnection } from "@/src/adapters/db/client";
import { createFsBrandPack } from "@/src/adapters/brand/fs-brand-pack";
import {
  createRepositories,
  type DbRepositories,
} from "@/src/adapters/db/repositories";
import { createFfmpegConcat } from "@/src/adapters/ffmpeg/ffmpeg-concat";
import { createFfmpegRender } from "@/src/adapters/ffmpeg/ffmpeg-render";
import { createFfmpegFullVideoEncode } from "@/src/adapters/ffmpeg/ffmpeg-full-video-encode";
import { createFfmpegFullVoMix } from "@/src/adapters/ffmpeg/ffmpeg-full-vo-mix";
import { createIbtFileTelemetry } from "@/src/adapters/ibt/ibt-file-telemetry";
import { createSqliteJobQueue } from "@/src/adapters/jobs/sqlite-queue";
import { isPublishJobType } from "@/src/application/defer-youtube-upload";
import { resumeDeferredYoutubeUploads } from "@/src/application/resume-deferred-youtube-uploads";
import { youtubeUploadCircuitBreaker } from "@/src/application/youtube-upload-circuit-breaker";
import { isYoutubeDailyUploadLimitCheckpoint } from "@/src/domain/youtube-upload-limit";
import { createOpenAiCompatibleLlm } from "@/src/adapters/llm/openai-compatible";
import { createLlmRaceHudExtractor } from "@/src/adapters/llm/llm-race-hud-extractor";
import { createLogger } from "@/src/adapters/logging/pino-logger";
import { createFsMediaStore } from "@/src/adapters/media/fs-media-store";
import { createFfmpegMediaProxy } from "@/src/adapters/media/ffmpeg-media-proxy";
import { createFfprobeMediaDuration } from "@/src/adapters/media/ffprobe-media-duration";
import { createYtdlpDownload } from "@/src/adapters/media/ytdlp-download";
import { createFsReplayCapture } from "@/src/adapters/replay/fs-replay-capture";
import { SystemClock } from "@/src/adapters/system/clock";
import { UuidIdPort } from "@/src/adapters/system/id";
import { createOpenAiCompatibleTts } from "@/src/adapters/tts/openai-compatible-tts";
import { createOpenAiCompatibleWhisper } from "@/src/adapters/transcription/openai-compatible-whisper";
import { createFileSettingsRepository } from "@/src/adapters/settings/file-settings";
import { GoogleYouTubeCatalogAdapter } from "@/src/adapters/youtube/catalog";
import { GoogleYouTubeAuthAdapter } from "@/src/adapters/youtube/oauth";
import { createGoogleYouTubeUpload } from "@/src/adapters/youtube/upload";
import { createGoogleYouTubeCaptions } from "@/src/adapters/youtube/youtube-captions";
import {
  createApproveCandidate,
  type ApproveCandidate,
} from "@/src/application/approve-candidate";
import {
  createConnectChannel,
  type ConnectChannel,
} from "@/src/application/connect-channel";
import {
  createSyncChannel,
  type SyncChannel,
} from "@/src/application/sync-channel";
import {
  createRunClipAnalysis,
  type RunClipAnalysis,
} from "@/src/application/run-clip-analysis";
import {
  createAssembleGeneratePreview,
  createRunIdeation,
  type AssembleGeneratePreview,
  type RunIdeation,
} from "@/src/application/run-ideation";
import {
  createRejectCandidate,
  type RejectCandidate,
} from "@/src/application/reject-candidate";
import {
  createRequestRevision,
  type RequestRevision,
} from "@/src/application/request-revision";
import {
  createRetryFailedJob,
  type RetryFailedJob,
} from "@/src/application/retry-failed-job";
import {
  createUpdateCandidateMetadata,
  type UpdateCandidateMetadata,
} from "@/src/application/update-candidate-metadata";
import {
  createGetCandidate,
  type GetCandidate,
} from "@/src/application/get-candidate";
import {
  createListCandidates,
  type ListCandidates,
} from "@/src/application/list-candidates";
import {
  createGetSettings,
  createUpdateSettings,
  type SettingsView,
} from "@/src/application/settings";
import {
  createGetHardware,
  createUpdateHardware,
} from "@/src/application/hardware";
import type { HardwareConfig } from "@/src/domain/hardware";
import {
  createCreateReplaySession,
  type CreateReplaySession,
} from "@/src/application/create-replay-session";
import {
  createAttachReplayIbt,
  createAttachReplayMedia,
  type AttachReplayIbt,
  type AttachReplayMedia,
} from "@/src/application/attach-replay-media";
import {
  createRunReplayAnalysis,
  type RunReplayAnalysis,
} from "@/src/application/run-replay-analysis";
import {
  createAddManualReplayMoment,
  type AddManualReplayMoment,
} from "@/src/application/add-manual-replay-moment";
import {
  createRequestReplayCapture,
  type RequestReplayCapture,
} from "@/src/application/request-replay-capture";
import {
  createRequestFullReplayPublish,
  type RequestFullReplayPublish,
} from "@/src/application/request-full-replay-publish";
import {
  createGenerateShortVoiceOvers,
  type GenerateShortVoiceOvers,
} from "@/src/application/generate-short-voice-overs";
import { createFsHardwareConfig } from "@/src/adapters/config/fs-hardware-config";
import {
  createEditorialLocalize,
  type EditorialLocalize,
} from "@/src/application/editorial-localize";
import {
  createPackageFullDeliveryAssets,
  type PackageFullDeliveryAssets,
} from "@/src/application/package-full-delivery-assets";
import {
  createGenerateFullVoiceOvers,
  type GenerateFullVoiceOvers,
} from "@/src/application/generate-full-voice-overs";
import { createRecoverQueue } from "@/src/application/recover-queue";
import {
  createRunReplayDirectorCapture,
  type RunReplayDirectorCapture,
} from "@/src/application/run-replay-director-capture";
import type { Logger } from "@/src/ports/logger";
import type { BrandPackPort } from "@/src/ports/brand-pack";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { RenderPort } from "@/src/ports/render";
import type { FullVideoEncodePort } from "@/src/ports/full-video-encode";
import type { VideoDownloadPort } from "@/src/ports/video-download";
import type { YouTubeUploadPort } from "@/src/ports/youtube-upload";
import type { YouTubeCaptionsPort } from "@/src/ports/youtube-captions";
import type { FullVoMixPort } from "@/src/ports/full-vo-mix";
import type { DurableJobQueue } from "@/src/ports/job-queue";
import type {
  AppSettings,
  SettingsRepository,
} from "@/src/ports/settings-repository";
import { createHandlers } from "@/src/workers/handlers";
import { createWorkerRunner } from "@/src/workers/runner";

import { loadEnv, type AppEnv } from "./env";

let workersStarted = false;

export type AppContainer = {
  connection: DbConnection;
  repositories: DbRepositories;
  auth: GoogleYouTubeAuthAdapter;
  catalog: GoogleYouTubeCatalogAdapter;
  connectChannel: ConnectChannel;
  syncChannel: SyncChannel;
  runClipAnalysis: RunClipAnalysis;
  runReplayAnalysis: RunReplayAnalysis;
  runIdeation: RunIdeation;
  assembleGeneratePreview: AssembleGeneratePreview;
  createReplaySession: CreateReplaySession;
  attachReplayMedia: AttachReplayMedia;
  attachReplayIbt: AttachReplayIbt;
  addManualReplayMoment: AddManualReplayMoment;
  requestReplayCapture: RequestReplayCapture;
  requestFullReplayPublish: RequestFullReplayPublish;
  generateShortVoiceOvers: GenerateShortVoiceOvers;
  generateFullVoiceOvers: GenerateFullVoiceOvers;
  editorialLocalize: EditorialLocalize;
  packageFullDeliveryAssets: PackageFullDeliveryAssets;
  runReplayDirectorCapture: RunReplayDirectorCapture;
  approveCandidate: ApproveCandidate;
  rejectCandidate: RejectCandidate;
  requestRevision: RequestRevision;
  updateCandidateMetadata: UpdateCandidateMetadata;
  retryFailedJob: RetryFailedJob;
  getCandidate: GetCandidate;
  listCandidates: ListCandidates;
  settings: SettingsRepository;
  getSettings: () => Promise<SettingsView>;
  updateSettings: (input: AppSettings) => Promise<AppSettings>;
  getHardware: () => Promise<HardwareConfig>;
  updateHardware: (input: HardwareConfig) => Promise<HardwareConfig>;
  jobQueue: DurableJobQueue;
  videoDownload: VideoDownloadPort;
  mediaStore: MediaStorePort;
  brandPack: BrandPackPort;
  render: RenderPort;
  fullVideoEncode: FullVideoEncodePort;
  fullVoMix: FullVoMixPort;
  upload: YouTubeUploadPort;
  captions: YouTubeCaptionsPort;
  logger: Logger;
  clock: SystemClock;
};

const globalContainer = globalThis as typeof globalThis & {
  ytShortCreatorContainer?: AppContainer;
};

export function createContainer(env: AppEnv): AppContainer {
  const connection = createDb(env.DATABASE_PATH);
  const repositories = createRepositories(connection.db);
  const logger = createLogger(env.LOG_LEVEL);
  const settings = createFileSettingsRepository({
    settingsPath: path.join(path.dirname(env.DATABASE_PATH), "settings.json"),
    defaults: {
      brandRoot: env.BRAND_ROOT,
      logLevel: env.LOG_LEVEL,
      defaultPrivacy: "public",
      videoEncoderPreference: "auto_igpu",
      brandVoiceProfile: "coral",
      italianVoiceProfile: "ash",
      shortsBurnInCaptions: true,
      fullBurnInCaptions: false,
      voiceDuckDb: -12,
      enableVoiceOverPipeline: true,
    },
  });
  const clock = new SystemClock();
  const id = new UuidIdPort();
  const mediaStore = createFsMediaStore({ mediaRoot: env.MEDIA_ROOT });
  const hardwareConfig = createFsHardwareConfig({ logger });
  const brandPack = createFsBrandPack({ brandRoot: env.BRAND_ROOT });
  const render = createFfmpegRender({ logger, settings });
  const fullVideoEncode = createFfmpegFullVideoEncode({ logger, settings });
  const fullVoMix = createFfmpegFullVoMix({ logger, settings });
  const videoDownload = createYtdlpDownload({ mediaStore, logger });
  const mediaDuration = createFfprobeMediaDuration();
  const ibtTelemetry = createIbtFileTelemetry({ logger });
  const videoConcat = createFfmpegConcat({ logger });
  const replayCapture = createFsReplayCapture({
    logger,
    videosDir: env.IRACING_VIDEOS_DIR || undefined,
    concat: videoConcat,
  });
  const llm = createOpenAiCompatibleLlm({
    apiKey: env.LLM_API_KEY,
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
    logger,
  });
  const transcription = createOpenAiCompatibleWhisper({
    apiKey: env.LLM_API_KEY,
    baseUrl: env.LLM_BASE_URL,
    model: env.WHISPER_MODEL,
    logger,
  });
  const mediaProxy = createFfmpegMediaProxy({ logger });
  const raceHudExtractor = createLlmRaceHudExtractor({ llm, logger });
  const tts = createOpenAiCompatibleTts({
    apiKey: env.TTS_API_KEY,
    baseUrl: env.TTS_BASE_URL,
    model: env.TTS_MODEL,
    logger,
  });
  const jobQueue = createSqliteJobQueue({
    db: connection.db,
    logger,
    idPort: id,
    clock,
    canClaimJob: (job) => {
      if (!isPublishJobType(job.type)) return true;
      const data = job.checkpoint?.data;
      if (isYoutubeDailyUploadLimitCheckpoint(data)) {
        return new Date(data.retryAfter).getTime() <= Date.now();
      }
      return youtubeUploadCircuitBreaker.shouldClaimPublishJob();
    },
  });
  const auth = new GoogleYouTubeAuthAdapter({
    clientId: env.YOUTUBE_CLIENT_ID,
    clientSecret: env.YOUTUBE_CLIENT_SECRET,
    redirectUri: env.YOUTUBE_REDIRECT_URI,
    tokenPath: path.join(
      path.dirname(env.DATABASE_PATH),
      "youtube-tokens.json",
    ),
  });
  const catalog = new GoogleYouTubeCatalogAdapter();
  const upload = createGoogleYouTubeUpload({ logger });
  const captions = createGoogleYouTubeCaptions({ logger });
  const runIdeation = createRunIdeation({
    llm,
    tts,
    mediaStore,
    briefs: repositories.generationBriefs,
    candidates: repositories.candidates,
    id,
    clock,
    logger,
  });
  const assembleGeneratePreview = createAssembleGeneratePreview({
    tts,
    mediaStore,
    briefs: repositories.generationBriefs,
    candidates: repositories.candidates,
    clock,
    logger,
  });
  const runReplayAnalysis = createRunReplayAnalysis({
    replaySessions: repositories.replaySessions,
    candidates: repositories.candidates,
    ibtTelemetry,
    mediaProxy,
    transcription,
    mediaStore,
    raceHudExtractor,
    llm,
    id,
    clock,
    logger,
  });
  const editorialLocalize = createEditorialLocalize({
    llm,
    hardware: hardwareConfig,
    logger,
  });
  const container: AppContainer = {
    connection,
    repositories,
    auth,
    catalog,
    logger,
    settings,
    jobQueue,
    videoDownload,
    mediaStore,
    brandPack,
    render,
    fullVideoEncode,
    fullVoMix,
    upload,
    captions,
    clock,
    connectChannel: createConnectChannel({
      auth,
      catalog,
      channels: repositories.channels,
      id,
      clock,
      logger,
    }),
    syncChannel: createSyncChannel({
      auth,
      catalog,
      channels: repositories.channels,
      sourceVideos: repositories.sourceVideos,
      id,
      clock,
      logger,
    }),
    runClipAnalysis: createRunClipAnalysis({
      llm,
      videoDownload,
      sourceVideos: repositories.sourceVideos,
      candidates: repositories.candidates,
      id,
      clock,
      logger,
    }),
    runReplayAnalysis,
    runIdeation,
    assembleGeneratePreview,
    createReplaySession: createCreateReplaySession({
      replaySessions: repositories.replaySessions,
      id,
      clock,
      logger,
    }),
    attachReplayMedia: createAttachReplayMedia({
      replaySessions: repositories.replaySessions,
      mediaDuration,
      clock,
      logger,
    }),
    attachReplayIbt: createAttachReplayIbt({
      replaySessions: repositories.replaySessions,
      clock,
      logger,
    }),
    addManualReplayMoment: createAddManualReplayMoment({
      replaySessions: repositories.replaySessions,
      candidates: repositories.candidates,
      id,
      clock,
      logger,
    }),
    requestReplayCapture: createRequestReplayCapture({
      replaySessions: repositories.replaySessions,
      capture: replayCapture,
      mediaDuration,
      clock,
      logger,
    }),
    requestFullReplayPublish: createRequestFullReplayPublish({
      replaySessions: repositories.replaySessions,
      queue: jobQueue,
      logger,
    }),
    generateShortVoiceOvers: createGenerateShortVoiceOvers({
      llm,
      tts,
      transcription,
      mediaDuration,
      mediaStore,
      candidates: repositories.candidates,
      replaySessions: repositories.replaySessions,
      settings,
      logger,
    }),
    editorialLocalize,
    generateFullVoiceOvers: createGenerateFullVoiceOvers({
      llm,
      tts,
      transcription,
      audioConcat: fullVoMix,
      mediaDuration,
      mediaStore,
      replaySessions: repositories.replaySessions,
      settings,
      clock,
      logger,
      editorialLocalize,
    }),
    packageFullDeliveryAssets: createPackageFullDeliveryAssets({
      mediaStore,
      replaySessions: repositories.replaySessions,
      fullVoMix,
      settings,
      clock,
      logger,
    }),
    runReplayDirectorCapture: createRunReplayDirectorCapture({
      replaySessions: repositories.replaySessions,
      candidates: repositories.candidates,
      capture: replayCapture,
      ibtTelemetry,
      mediaDuration,
      id,
      clock,
      logger,
      mediaRoot: env.MEDIA_ROOT,
    }),
    approveCandidate: createApproveCandidate({
      candidates: repositories.candidates,
      queue: jobQueue,
      logger,
    }),
    rejectCandidate: createRejectCandidate({
      candidates: repositories.candidates,
      logger,
    }),
    requestRevision: createRequestRevision({
      candidates: repositories.candidates,
      logger,
    }),
    updateCandidateMetadata: createUpdateCandidateMetadata({
      candidates: repositories.candidates,
      clock,
      logger,
    }),
    retryFailedJob: createRetryFailedJob({
      candidates: repositories.candidates,
      queue: jobQueue,
      logger,
    }),
    getCandidate: createGetCandidate({ candidates: repositories.candidates }),
    listCandidates: createListCandidates({
      candidates: repositories.candidates,
    }),
    getSettings: createGetSettings({
      settings,
      secrets: {
        youtubeClientSecret: env.YOUTUBE_CLIENT_SECRET,
        llmApiKey: env.LLM_API_KEY,
        ttsApiKey: env.TTS_API_KEY,
      },
      logger,
    }),
    updateSettings: createUpdateSettings({ settings, logger }),
    getHardware: createGetHardware({ hardware: hardwareConfig, logger }),
    updateHardware: createUpdateHardware({ hardware: hardwareConfig, logger }),
  };

  return container;
}

export function getContainer(): AppContainer {
  if (!globalContainer.ytShortCreatorContainer) {
    globalContainer.ytShortCreatorContainer = createContainer(loadEnv());
  }
  return globalContainer.ytShortCreatorContainer;
}

/**
 * Runs boot recovery, then unconditionally starts the worker runner.
 *
 * A recovery failure (e.g. a transient DB error) must never permanently
 * disable job processing, so the failure is logged as a warning and
 * swallowed here rather than propagated up and left unhandled.
 */
export async function recoverThenStartWorkers(
  recoverQueue: () => Promise<unknown>,
  runner: Pick<ReturnType<typeof createWorkerRunner>, "start">,
  logger: Logger,
  options?: {
    resumeDeferredUploads?: () => Promise<unknown>;
  },
): Promise<void> {
  try {
    await recoverQueue();
  } catch (error: unknown) {
    logger.warn("Queue recovery failed; starting workers anyway", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
  if (options?.resumeDeferredUploads) {
    try {
      await options.resumeDeferredUploads();
    } catch (error: unknown) {
      logger.warn("Deferred YouTube upload resume failed on boot", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }
  runner.start();
  logger.info("Workers started");
}

const YOUTUBE_UPLOAD_RESUME_INTERVAL_MS = 5 * 60 * 1000;

export function startWorkers(): void {
  if (workersStarted) {
    return;
  }
  workersStarted = true;

  const container = getContainer();
  const logger = container.logger;
  const resumeDeferredUploads = () =>
    resumeDeferredYoutubeUploads({
      queue: container.jobQueue,
      breaker: youtubeUploadCircuitBreaker,
      logger,
    });
  const runner = createWorkerRunner({
    queue: container.jobQueue,
    handlers: createHandlers({
      logger,
      sourceVideos: container.repositories.sourceVideos,
      replaySessions: container.repositories.replaySessions,
      videoDownload: container.videoDownload,
      runClipAnalysis: container.runClipAnalysis,
      runReplayAnalysis: container.runReplayAnalysis,
      requestReplayCapture: container.requestReplayCapture,
      runReplayDirectorCapture: container.runReplayDirectorCapture,
      runIdeation: container.runIdeation,
      assembleGeneratePreview: container.assembleGeneratePreview,
      candidates: container.repositories.candidates,
      jobs: container.repositories.jobs,
      render: container.render,
      brandPack: container.brandPack,
      mediaStore: container.mediaStore,
      fullVideoEncode: container.fullVideoEncode,
      fullVoMix: container.fullVoMix,
      generateFullVoiceOvers: container.generateFullVoiceOvers,
      packageFullDeliveryAssets: container.packageFullDeliveryAssets,
      queue: container.jobQueue,
      settings: container.settings,
      auth: container.auth,
      upload: container.upload,
      captions: container.captions,
      clock: container.clock,
    }),
    logger,
    clock: container.clock,
  });
  const recoverQueue = createRecoverQueue({
    queue: container.jobQueue,
    candidates: container.repositories.candidates,
    logger,
  });

  setInterval(() => {
    void resumeDeferredUploads().catch((error: unknown) => {
      logger.warn("Periodic deferred YouTube upload resume failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, YOUTUBE_UPLOAD_RESUME_INTERVAL_MS);

  recoverThenStartWorkers(recoverQueue, runner, logger, {
    resumeDeferredUploads,
  }).catch((error: unknown) => {
    // Only reachable if runner.start() itself throws. Reset the guard so a
    // later call to startWorkers() (e.g. a subsequent request) can retry.
    workersStarted = false;
    logger.error("Workers failed to start", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  });
}
