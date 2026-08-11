import { spawn } from "node:child_process";
import fs from "node:fs/promises";

import type { Logger } from "@/src/ports/logger";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { VideoDownloadPort } from "@/src/ports/video-download";

const YTDLP_PROGRESS_RE = /\[download\]\s+([\d.]+)%/;

type YtdlpDownloadDeps = {
  mediaStore: MediaStorePort;
  logger: Logger;
  ytdlpPath?: string;
};

function youtubeWatchUrl(youtubeVideoId: string): string {
  return `https://www.youtube.com/watch?v=${youtubeVideoId}`;
}

async function fileSizeIfExists(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function runYtdlp(
  ytdlpPath: string,
  args: string[],
  onStderrLine: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlpPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderrBuffer = "";

    proc.stderr.on("data", (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() ?? "";
      for (const line of lines) {
        onStderrLine(line);
      }
    });

    proc.on("error", (error) => {
      reject(error);
    });

    proc.on("close", (code) => {
      if (stderrBuffer.trim()) {
        onStderrLine(stderrBuffer.trim());
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`yt-dlp exited with code ${code ?? "unknown"}`));
    });
  });
}

export function createYtdlpDownload(deps: YtdlpDownloadDeps): VideoDownloadPort {
  const ytdlpPath = deps.ytdlpPath ?? "yt-dlp";
  const downloadLogger = deps.logger.child({ component: "YtdlpDownload" });

  return {
    async download(youtubeVideoId: string): Promise<string> {
      const startedAt = Date.now();
      await deps.mediaStore.ensureDirs();
      const outputPath = deps.mediaStore.sourcePath(youtubeVideoId);

      const existingSize = await fileSizeIfExists(outputPath);
      if (existingSize !== null && existingSize > 0) {
        const durationMs = Date.now() - startedAt;
        downloadLogger.info("Skipping yt-dlp download; file already present", {
          youtubeVideoId,
          outputPath,
          sizeBytes: existingSize,
          durationMs,
        });
        return outputPath;
      }

      downloadLogger.info("Starting yt-dlp download", {
        youtubeVideoId,
        outputPath,
      });

      let lastLoggedPct = -1;

      await runYtdlp(
        ytdlpPath,
        [
          "--no-playlist",
          "--merge-output-format",
          "mp4",
          "-o",
          outputPath,
          youtubeWatchUrl(youtubeVideoId),
        ],
        (line) => {
          const match = YTDLP_PROGRESS_RE.exec(line);
          if (!match) {
            return;
          }

          const pct = Math.round(Number.parseFloat(match[1]));
          if (Number.isNaN(pct) || pct <= lastLoggedPct) {
            return;
          }

          lastLoggedPct = pct;
          downloadLogger.info("yt-dlp download progress", {
            youtubeVideoId,
            progressPct: pct,
          });
        },
      );

      const finalSize = await fileSizeIfExists(outputPath);
      if (finalSize === null || finalSize === 0) {
        throw new Error(
          `yt-dlp finished but output is missing or empty: ${outputPath}`,
        );
      }

      const durationMs = Date.now() - startedAt;
      downloadLogger.info("yt-dlp download completed", {
        youtubeVideoId,
        outputPath,
        sizeBytes: finalSize,
        durationMs,
      });

      return outputPath;
    },
  };
}
