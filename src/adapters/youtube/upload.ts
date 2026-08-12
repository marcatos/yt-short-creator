import fs from "node:fs";
import fsPromises from "node:fs/promises";

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
      const fileStat = await fsPromises.stat(input.filePath);
      const fileSizeBytes = fileStat.size;
      log.info("YouTube resumable upload started", {
        filePath: input.filePath,
        scheduled: input.scheduledAt !== null,
        privacy: input.privacy,
        contentKind: input.contentKind ?? "short",
        tagCount: input.tags.length,
        fileSizeBytes,
        fileSizeMb: Math.round(fileSizeBytes / (1024 * 1024)),
      });
      try {
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: input.accessToken });
        const youtube = google.youtube({ version: "v3", auth });

        let lastLoggedPct = -1;
        const response = await youtube.videos.insert(
          {
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
              mimeType: "video/mp4",
              body: fs.createReadStream(input.filePath, {
                highWaterMark: 8 * 1024 * 1024,
              }),
            },
          },
          {
            // Large full-race uploads can exceed default HTTP timeouts.
            timeout: 0,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            onUploadProgress: (event: { bytesRead?: number }) => {
              const bytesRead = event.bytesRead ?? 0;
              if (fileSizeBytes <= 0) return;
              const pct = Math.floor((bytesRead / fileSizeBytes) * 100);
              if (pct >= lastLoggedPct + 5 || pct === 100) {
                lastLoggedPct = pct;
                log.info("YouTube upload progress", {
                  filePath: input.filePath,
                  pct,
                  bytesRead,
                  fileSizeBytes,
                  elapsedMs: Math.round(performance.now() - startedAt),
                });
              }
            },
          },
        );
        const youtubeVideoId = response.data.id;
        if (!youtubeVideoId) {
          throw new Error("YouTube upload completed without a video id");
        }
        log.info("YouTube resumable upload completed", {
          filePath: input.filePath,
          youtubeVideoId,
          fileSizeBytes,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return { youtubeVideoId };
      } catch (error) {
        log.error("YouTube resumable upload failed", {
          filePath: input.filePath,
          fileSizeBytes,
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
