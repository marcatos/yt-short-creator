import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";

import type { Logger } from "@/src/ports/logger";
import type { VideoConcatPort } from "@/src/ports/video-concat";

export function createFfmpegConcat(deps: {
  logger: Logger;
  ffmpegPath?: string;
}): VideoConcatPort {
  const ffmpegPath = deps.ffmpegPath ?? "ffmpeg";
  const log = deps.logger.child({ component: "FfmpegConcat" });

  return {
    async concat({ segmentPaths, outputPath }) {
      const startedAt = performance.now();
      if (segmentPaths.length === 0) {
        throw new Error("No segments to concatenate");
      }
      if (segmentPaths.length === 1) {
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.copyFile(segmentPaths[0]!, outputPath);
        return outputPath;
      }

      const listFile = path.join(
        os.tmpdir(),
        `yt-concat-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
      );
      const listBody = segmentPaths
        .map((segment) => `file '${segment.replace(/'/g, "'\\''")}'`)
        .join("\n");
      await fs.writeFile(listFile, listBody, "utf8");
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      log.info("FFmpeg concat started", {
        segmentCount: segmentPaths.length,
        outputPath,
      });

      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(
            ffmpegPath,
            [
              "-y",
              "-hide_banner",
              "-f",
              "concat",
              "-safe",
              "0",
              "-i",
              listFile,
              "-c",
              "copy",
              outputPath,
            ],
            { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
          );
          let stderr = "";
          child.stderr.setEncoding("utf8");
          child.stderr.on("data", (chunk: string) => {
            stderr = `${stderr}${chunk}`.slice(-6_000);
          });
          child.once("error", reject);
          child.once("close", (code) => {
            if (code === 0) {
              resolve();
              return;
            }
            reject(
              new Error(`FFmpeg concat exited with code ${code}: ${stderr.trim()}`),
            );
          });
        });
        log.info("FFmpeg concat completed", {
          outputPath,
          segmentCount: segmentPaths.length,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return outputPath;
      } finally {
        await fs.rm(listFile, { force: true }).catch(() => undefined);
      }
    },
  };
}
