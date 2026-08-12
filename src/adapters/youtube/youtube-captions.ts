import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";

import type { Logger } from "@/src/ports/logger";
import type { YouTubeCaptionsPort } from "@/src/ports/youtube-captions";

const CAPTIONS_UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart";

export function createGoogleYouTubeCaptions(deps: {
  logger: Logger;
}): YouTubeCaptionsPort {
  const log = deps.logger.child({ adapter: "GoogleYouTubeCaptions" });

  return {
    async upload(input) {
      const startedAt = performance.now();
      log.info("YouTube caption upload started", {
        youtubeVideoId: input.youtubeVideoId,
        language: input.language,
        filePath: input.filePath,
      });
      try {
        const captions = await fs.readFile(input.filePath, "utf8");
        const boundary = `youtube-caption-${randomUUID()}`;
        const metadata = JSON.stringify({
          snippet: {
            videoId: input.youtubeVideoId,
            language: input.language,
            name: input.name,
            isDraft: false,
          },
        });
        const body = [
          `--${boundary}`,
          "Content-Type: application/json; charset=UTF-8",
          "",
          metadata,
          `--${boundary}`,
          "Content-Type: application/x-subrip; charset=UTF-8",
          "",
          captions,
          `--${boundary}--`,
          "",
        ].join("\r\n");

        const response = await fetch(CAPTIONS_UPLOAD_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body,
        });
        if (!response.ok) {
          const responseBody = await response.text();
          throw new Error(
            `YouTube caption upload failed (${response.status}): ${responseBody.slice(0, 1_000)}`,
          );
        }
        const result = (await response.json()) as { id?: unknown };
        if (typeof result.id !== "string" || !result.id) {
          throw new Error("YouTube caption upload completed without a caption id");
        }
        log.info("YouTube caption upload completed", {
          youtubeVideoId: input.youtubeVideoId,
          youtubeCaptionId: result.id,
          language: input.language,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return { youtubeCaptionId: result.id };
      } catch (error) {
        log.error("YouTube caption upload failed", {
          youtubeVideoId: input.youtubeVideoId,
          language: input.language,
          filePath: input.filePath,
          durationMs: Math.round(performance.now() - startedAt),
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : String(error),
        });
        throw error;
      }
    },
  };
}
