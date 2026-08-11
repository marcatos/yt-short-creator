import { createDb, type DbConnection } from "@/src/adapters/db/client";
import {
  createRepositories,
  type DbRepositories,
} from "@/src/adapters/db/repositories";
import {
  createInProcessJobQueue,
  type InProcessJobQueue,
} from "@/src/adapters/jobs/in-process-queue";
import { createOpenAiCompatibleLlm } from "@/src/adapters/llm/openai-compatible";
import { createLogger } from "@/src/adapters/logging/pino-logger";
import { createFsMediaStore } from "@/src/adapters/media/fs-media-store";
import { createYtdlpDownload } from "@/src/adapters/media/ytdlp-download";
import { SystemClock } from "@/src/adapters/system/clock";
import { UuidIdPort } from "@/src/adapters/system/id";
import { createOpenAiCompatibleTts } from "@/src/adapters/tts/openai-compatible-tts";
import { GoogleYouTubeCatalogAdapter } from "@/src/adapters/youtube/catalog";
import { GoogleYouTubeAuthAdapter } from "@/src/adapters/youtube/oauth";
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
import type { Logger } from "@/src/ports/logger";
import type { VideoDownloadPort } from "@/src/ports/video-download";
import { createHandlers } from "@/src/workers/handlers";
import { createWorkerRunner } from "@/src/workers/runner";

import { loadEnv } from "./env";

let workersStarted = false;

export type AppContainer = {
  connection: DbConnection;
  repositories: DbRepositories;
  auth: GoogleYouTubeAuthAdapter;
  catalog: GoogleYouTubeCatalogAdapter;
  connectChannel: ConnectChannel;
  syncChannel: SyncChannel;
  runClipAnalysis: RunClipAnalysis;
  runIdeation: RunIdeation;
  assembleGeneratePreview: AssembleGeneratePreview;
  jobQueue: InProcessJobQueue;
  videoDownload: VideoDownloadPort;
  logger: Logger;
};

const globalContainer = globalThis as typeof globalThis & {
  ytShortCreatorContainer?: AppContainer;
};

export function getContainer(): AppContainer {
  if (globalContainer.ytShortCreatorContainer) {
    return globalContainer.ytShortCreatorContainer;
  }

  const env = loadEnv();
  const connection = createDb(env.DATABASE_PATH);
  const repositories = createRepositories(connection.db);
  const logger = createLogger(env.LOG_LEVEL);
  const clock = new SystemClock();
  const id = new UuidIdPort();
  const mediaStore = createFsMediaStore({ mediaRoot: env.MEDIA_ROOT });
  const videoDownload = createYtdlpDownload({ mediaStore, logger });
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
  });
  const catalog = new GoogleYouTubeCatalogAdapter();
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
  const container: AppContainer = {
    connection,
    repositories,
    auth,
    catalog,
    logger,
    jobQueue,
    videoDownload,
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
    runIdeation,
    assembleGeneratePreview,
  };

  globalContainer.ytShortCreatorContainer = container;
  return container;
}

export function startWorkers(): void {
  if (workersStarted) {
    return;
  }
  workersStarted = true;

  const container = getContainer();
  const logger = container.logger;
  const clock = new SystemClock();
  const runner = createWorkerRunner({
    queue: container.jobQueue,
    handlers: createHandlers({
      logger,
      sourceVideos: container.repositories.sourceVideos,
      videoDownload: container.videoDownload,
      runClipAnalysis: container.runClipAnalysis,
      runIdeation: container.runIdeation,
      assembleGeneratePreview: container.assembleGeneratePreview,
    }),
    logger,
    clock,
  });

  runner.start();
  logger.info("Workers started");
}
