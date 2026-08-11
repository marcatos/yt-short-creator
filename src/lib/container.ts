import path from "node:path";

import { createDb, type DbConnection } from "@/src/adapters/db/client";
import { createFsBrandPack } from "@/src/adapters/brand/fs-brand-pack";
import {
  createRepositories,
  type DbRepositories,
} from "@/src/adapters/db/repositories";
import { createFfmpegRender } from "@/src/adapters/ffmpeg/ffmpeg-render";
import { createIbtFileTelemetry } from "@/src/adapters/ibt/ibt-file-telemetry";
import {
  createInProcessJobQueue,
  type InProcessJobQueue,
} from "@/src/adapters/jobs/in-process-queue";
import { createOpenAiCompatibleLlm } from "@/src/adapters/llm/openai-compatible";
import { createLogger } from "@/src/adapters/logging/pino-logger";
import { createFsMediaStore } from "@/src/adapters/media/fs-media-store";
import { createFfprobeMediaDuration } from "@/src/adapters/media/ffprobe-media-duration";
import { createYtdlpDownload } from "@/src/adapters/media/ytdlp-download";
import { createFsReplayCapture } from "@/src/adapters/replay/fs-replay-capture";
import { SystemClock } from "@/src/adapters/system/clock";
import { UuidIdPort } from "@/src/adapters/system/id";
import { createOpenAiCompatibleTts } from "@/src/adapters/tts/openai-compatible-tts";
import { createFileSettingsRepository } from "@/src/adapters/settings/file-settings";
import { GoogleYouTubeCatalogAdapter } from "@/src/adapters/youtube/catalog";
import { GoogleYouTubeAuthAdapter } from "@/src/adapters/youtube/oauth";
import { createGoogleYouTubeUpload } from "@/src/adapters/youtube/upload";
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
import type { Logger } from "@/src/ports/logger";
import type { BrandPackPort } from "@/src/ports/brand-pack";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { RenderPort } from "@/src/ports/render";
import type { VideoDownloadPort } from "@/src/ports/video-download";
import type { YouTubeUploadPort } from "@/src/ports/youtube-upload";
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
  jobQueue: InProcessJobQueue;
  videoDownload: VideoDownloadPort;
  mediaStore: MediaStorePort;
  brandPack: BrandPackPort;
  render: RenderPort;
  upload: YouTubeUploadPort;
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
    },
  });
  const clock = new SystemClock();
  const id = new UuidIdPort();
  const mediaStore = createFsMediaStore({ mediaRoot: env.MEDIA_ROOT });
  const brandPack = createFsBrandPack({ brandRoot: env.BRAND_ROOT });
  const render = createFfmpegRender({ logger, settings });
  const videoDownload = createYtdlpDownload({ mediaStore, logger });
  const mediaDuration = createFfprobeMediaDuration();
  const ibtTelemetry = createIbtFileTelemetry({ logger });
  const replayCapture = createFsReplayCapture({
    logger,
    videosDir: env.IRACING_VIDEOS_DIR || undefined,
  });
  const llm = createOpenAiCompatibleLlm({
    apiKey: env.LLM_API_KEY,
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
    logger,
  });
  const tts = createOpenAiCompatibleTts({
    apiKey: env.TTS_API_KEY,
    baseUrl: env.TTS_BASE_URL,
    model: env.TTS_MODEL,
    logger,
  });
  const jobQueue = createInProcessJobQueue({
    logger,
    idPort: id,
    clock,
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
    llm,
    id,
    clock,
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
    upload,
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
  };

  return container;
}

export function getContainer(): AppContainer {
  if (!globalContainer.ytShortCreatorContainer) {
    globalContainer.ytShortCreatorContainer = createContainer(loadEnv());
  }
  return globalContainer.ytShortCreatorContainer;
}

export function startWorkers(): void {
  if (workersStarted) {
    return;
  }
  workersStarted = true;

  const container = getContainer();
  const logger = container.logger;
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
      runIdeation: container.runIdeation,
      assembleGeneratePreview: container.assembleGeneratePreview,
      candidates: container.repositories.candidates,
      jobs: container.repositories.jobs,
      render: container.render,
      brandPack: container.brandPack,
      mediaStore: container.mediaStore,
      queue: container.jobQueue,
      settings: container.settings,
      auth: container.auth,
      upload: container.upload,
      clock: container.clock,
    }),
    logger,
    clock: container.clock,
  });

  runner.start();
  logger.info("Workers started");
}
