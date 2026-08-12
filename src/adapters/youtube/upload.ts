import fs from "node:fs";

import { google } from "googleapis";

import type { Logger } from "@/src/ports/logger";
import type {
  YouTubeUploadInput,
  YouTubeUploadPort,
} from "@/src/ports/youtube-upload";

function shortDescription(input: YouTubeUploadInput): string {
  if (input.contentKind === "full") return input.description;
  const metadata = `${input.title} ${input.description} ${input.tags.join(" ")}`;
  if (/(^|\s)#shorts\b/i.test(metadata)) return input.description;
  return input.description ? `${input.description}\n\n#Shorts` : "#Shorts";
}

export function createGoogleYouTubeUpload(deps: {
  logger: Logger;
}): YouTubeUploadPort {
  const log = deps.logger.child({ adapter: "GoogleYouTubeUpload" });
  return {
    async upload(input) {
      const startedAt = performance.now();
      log.info("YouTube resumable upload started", {
        filePath: input.filePath,
        scheduled: input.scheduledAt !== null,
        privacy: input.privacy,
        contentKind: input.contentKind ?? "short",
        tagCount: input.tags.length,
      });
      try {
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: input.accessToken });
        const youtube = google.youtube({ version: "v3", auth });
        const response = await youtube.videos.insert({
          part: ["snippet", "status"],
          notifySubscribers: false,
          requestBody: {
            snippet: {
              title: input.title,
              description: shortDescription(input),
              tags: input.tags,
              categoryId: "2",
            },
            status: {
              privacyStatus: input.scheduledAt ? "private" : input.privacy,
              publishAt: input.scheduledAt?.toISOString(),
              selfDeclaredMadeForKids: false,
            },
          },
          media: {
            body: fs.createReadStream(input.filePath),
          },
        });
        const youtubeVideoId = response.data.id;
        if (!youtubeVideoId) {
          throw new Error("YouTube upload completed without a video id");
        }
        log.info("YouTube resumable upload completed", {
          filePath: input.filePath,
          youtubeVideoId,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return { youtubeVideoId };
      } catch (error) {
        log.error("YouTube resumable upload failed", {
          filePath: input.filePath,
          durationMs: Math.round(performance.now() - startedAt),
          error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
        });
        throw error;
      }
    },
  };
}
