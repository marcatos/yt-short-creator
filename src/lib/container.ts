import { createDb, type DbConnection } from "@/src/adapters/db/client";
import {
  createRepositories,
  type DbRepositories,
} from "@/src/adapters/db/repositories";
import { createInProcessJobQueue } from "@/src/adapters/jobs/in-process-queue";
import { createLogger } from "@/src/adapters/logging/pino-logger";
import { SystemClock } from "@/src/adapters/system/clock";
import { UuidIdPort } from "@/src/adapters/system/id";
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
import type { Logger } from "@/src/ports/logger";
import { createStubHandlers } from "@/src/workers/handlers";
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
  const auth = new GoogleYouTubeAuthAdapter({
    clientId: env.YOUTUBE_CLIENT_ID,
    clientSecret: env.YOUTUBE_CLIENT_SECRET,
    redirectUri: env.YOUTUBE_REDIRECT_URI,
  });
  const catalog = new GoogleYouTubeCatalogAdapter();
  const container: AppContainer = {
    connection,
    repositories,
    auth,
    catalog,
    logger,
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
  };

  globalContainer.ytShortCreatorContainer = container;
  return container;
}

export function startWorkers(): void {
  if (workersStarted) {
    return;
  }
  workersStarted = true;

  const logger = createLogger();
  const clock = new SystemClock();
  const queue = createInProcessJobQueue({
    logger,
    idPort: new UuidIdPort(),
    clock,
  });
  const runner = createWorkerRunner({
    queue,
    handlers: createStubHandlers(),
    logger,
    clock,
  });

  runner.start();
  logger.info("Workers started");
}
