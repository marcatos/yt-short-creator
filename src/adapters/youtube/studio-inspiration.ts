import { chromium } from "playwright";

import type { Logger } from "@/src/ports/logger";
import {
  StudioSessionUnavailableError,
  type InspirationCaptureResult,
  type YouTubeStudioInspirationPort,
} from "@/src/ports/youtube-studio-inspiration";

import { withStudioLock } from "./studio-mutex";
import {
  isStudioHeaded,
  resolveStudioProfileDir,
  studioPersistentContextOptions,
  studioProfileExists,
} from "./studio-profile";
import {
  createPlaywrightInspirationHelpers,
  scrapeInspirationIdeas,
  wrapInspirationScrapeError,
  type InspirationPageHelpers,
  type PageLike,
} from "./studio-inspiration-scrape";

export {
  INSPIRATION_SELECTORS,
  createPlaywrightInspirationHelpers,
  scrapeInspirationIdeas,
} from "./studio-inspiration-scrape";
export {
  buildInspirationExternalKey,
  parseIdeaFromTexts,
} from "./studio-inspiration-parse";

export type StudioPersistentContext = {
  pages(): unknown[];
  newPage(): Promise<unknown>;
  close(): Promise<void>;
};

export type StudioBrowserFactory = (input: {
  profileDir: string;
  headed: boolean;
}) => Promise<StudioPersistentContext>;

export type InspirationPageHelpersFactory = (
  page: unknown,
) => InspirationPageHelpers;

export type StudioInspirationAdapterDeps = {
  env?: Record<string, string | undefined>;
  logger?: Logger;
  browserFactory?: StudioBrowserFactory;
  pageHelpersFactory?: InspirationPageHelpersFactory;
  withLock?: <T>(fn: () => Promise<T>) => Promise<T>;
  profileExists?: (profileDir: string) => boolean;
};

async function defaultBrowserFactory(input: {
  profileDir: string;
  headed: boolean;
}): Promise<StudioPersistentContext> {
  return chromium.launchPersistentContext(
    input.profileDir,
    studioPersistentContextOptions({ headed: input.headed }),
  );
}

function defaultPageHelpersFactory(page: unknown): InspirationPageHelpers {
  return createPlaywrightInspirationHelpers(page as PageLike);
}

function errorMeta(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { error: String(error) };
}

export function createYouTubeStudioInspirationAdapter(
  deps?: StudioInspirationAdapterDeps,
): YouTubeStudioInspirationPort {
  const env = deps?.env ?? process.env;
  const log = deps?.logger?.child({ component: "StudioInspiration" });
  const browserFactory = deps?.browserFactory ?? defaultBrowserFactory;
  const pageHelpersFactory =
    deps?.pageHelpersFactory ?? defaultPageHelpersFactory;
  const withLock = deps?.withLock ?? withStudioLock;
  const profileExists = deps?.profileExists ?? studioProfileExists;

  return {
    async sync(): Promise<InspirationCaptureResult> {
      const startedAt = performance.now();
      log?.info("Studio inspiration sync starting");
      try {
        const result = await withLock(async () => {
          const profileDir = resolveStudioProfileDir(env);
          if (!profileExists(profileDir)) {
            throw new StudioSessionUnavailableError(
              "YouTube Studio profile is missing; run npm run studio:login",
            );
          }

          const headed = isStudioHeaded(env);
          const launchStartedAt = performance.now();
          const context = await browserFactory({ profileDir, headed });
          log?.info("Studio Chrome launched", {
            headed,
            durationMs: Math.round(performance.now() - launchStartedAt),
          });

          try {
            // Prefer a fresh tab — restored Studio tabs from the persistent
            // profile often ignore SPA route changes under automation.
            for (const existing of context.pages()) {
              await (existing as { close(): Promise<void> })
                .close()
                .catch(() => undefined);
            }
            const page = await context.newPage();
            const helpers = pageHelpersFactory(page);
            return await scrapeInspirationIdeas(helpers, log);
          } finally {
            await context.close().catch((closeError: unknown) => {
              log?.warn("Studio browser context close failed", {
                error: errorMeta(closeError),
              });
            });
          }
        });

        log?.info("Studio inspiration sync finished", {
          status: result.status,
          ideaCount: result.ideas.length,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return result;
      } catch (error) {
        log?.error("Studio inspiration sync failed", {
          durationMs: Math.round(performance.now() - startedAt),
          error: errorMeta(error),
        });
        wrapInspirationScrapeError(error);
      }
    },
  };
}
