import type { Logger } from "@/src/ports/logger";
import {
  StudioInspirationUiError,
  StudioSessionUnavailableError,
  type InspirationCaptureResult,
  type YouTubeStudioInspirationPort,
} from "@/src/ports/youtube-studio-inspiration";

import { withStudioLock } from "./studio-mutex";
import {
  resolveStudioProfileDir,
  studioProfileExists,
} from "./studio-profile";

export function createYouTubeStudioInspirationAdapter(deps?: {
  env?: Record<string, string | undefined>;
  logger?: Logger;
}): YouTubeStudioInspirationPort {
  const env = deps?.env ?? process.env;
  const log = deps?.logger?.child({ component: "StudioInspiration" });

  return {
    async sync(): Promise<InspirationCaptureResult> {
      const startedAt = performance.now();
      log?.info("Studio inspiration sync starting");
      try {
        return await withStudioLock(async () => {
          const profileDir = resolveStudioProfileDir(env);
          if (!studioProfileExists(profileDir)) {
            throw new StudioSessionUnavailableError(
              "YouTube Studio profile is missing; run npm run studio:login",
            );
          }
          // DOM scrape lands in Task 4.
          throw new StudioInspirationUiError(
            "Inspiration DOM scrape is not implemented yet",
          );
        });
      } catch (error) {
        log?.error("Studio inspiration sync failed", {
          durationMs: Math.round(performance.now() - startedAt),
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        throw error;
      }
    },
  };
}
