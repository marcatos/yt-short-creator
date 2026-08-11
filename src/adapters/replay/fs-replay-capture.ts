import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  ReplayCapturePort,
  WaitForNewRecordingInput,
} from "@/src/ports/replay-capture";
import type { Logger } from "@/src/ports/logger";

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".avi",
  ".mov",
  ".mkv",
  ".webm",
]);

async function listVideoFiles(dir: string): Promise<
  Array<{ fullPath: string; mtimeMs: number }>
> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: Array<{ fullPath: string; mtimeMs: number }> = [];
  await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const ext = path.extname(entry.name).toLowerCase();
        if (!VIDEO_EXTENSIONS.has(ext)) return;
        const fullPath = path.join(dir, entry.name);
        const stats = await fs.stat(fullPath);
        files.push({ fullPath, mtimeMs: stats.mtimeMs });
      }),
  );
  return files;
}

export function createFsReplayCapture(deps: {
  logger: Logger;
  videosDir?: string;
  pollIntervalMs?: number;
}): ReplayCapturePort {
  const log = deps.logger.child({ component: "FsReplayCapture" });
  const pollIntervalMs = deps.pollIntervalMs ?? 2_000;

  return {
    defaultVideosDir() {
      if (deps.videosDir) return deps.videosDir;
      return path.join(os.homedir(), "Documents", "iRacing", "videos");
    },

    async waitForNewRecording(input: WaitForNewRecordingInput): Promise<string> {
      const startedAt = performance.now();
      const sinceMs = input.since.getTime() - 1_000;
      log.info("Waiting for new replay recording", {
        watchDir: input.watchDir,
        timeoutMs: input.timeoutMs,
        since: input.since.toISOString(),
      });

      try {
        await fs.access(input.watchDir);
      } catch {
        throw new Error(
          `iRacing videos folder not found: ${input.watchDir}. Open iRacing and capture a replay, or attach an MP4 manually.`,
        );
      }

      const deadline = Date.now() + input.timeoutMs;
      while (Date.now() < deadline) {
        const files = await listVideoFiles(input.watchDir);
        const newest = files
          .filter((file) => file.mtimeMs >= sinceMs)
          .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
        if (newest) {
          log.info("New replay recording detected", {
            mediaPath: newest.fullPath,
            durationMs: Math.round(performance.now() - startedAt),
          });
          return newest.fullPath;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      throw new Error(
        `No new recording appeared in ${input.watchDir} within ${Math.round(input.timeoutMs / 1000)}s. Ensure iRacing is open with the .rpy loaded and capture is enabled (Ctrl+Alt+Shift+V or OBS).`,
      );
    },
  };
}
