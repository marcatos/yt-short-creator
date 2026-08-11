import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  AutoCaptureInput,
  DirectedCaptureInput,
  DirectedCaptureResult,
  ReplayCapturePort,
  WaitForNewRecordingInput,
} from "@/src/ports/replay-capture";
import type { Logger } from "@/src/ports/logger";
import type { VideoConcatPort } from "@/src/ports/video-concat";

import {
  createPowershellIracingBroadcast,
  IracingBroadcastMsg,
  IracingReplaySearchMode,
  IracingVideoCaptureMode,
  type IracingBroadcastPort,
} from "./iracing-broadcast";
import {
  createIracingSimControl,
  type IracingSimControl,
} from "./iracing-sim-control";

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".avi",
  ".mov",
  ".mkv",
  ".webm",
]);

const DEFAULT_RECORD_MS = 10 * 60_000;
const LOAD_SETTLE_MS = 8_000;
const STOP_SETTLE_MS = 3_000;
const SIM_WAIT_MS = 180_000;

async function listVideoFiles(dir: string): Promise<
  Array<{ fullPath: string; mtimeMs: number; size: number }>
> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: Array<{ fullPath: string; mtimeMs: number; size: number }> = [];
  await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const ext = path.extname(entry.name).toLowerCase();
        if (!VIDEO_EXTENSIONS.has(ext)) return;
        const fullPath = path.join(dir, entry.name);
        const stats = await fs.stat(fullPath);
        files.push({
          fullPath,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
        });
      }),
  );
  return files;
}

export type FsReplayCaptureDeps = {
  logger: Logger;
  videosDir?: string;
  pollIntervalMs?: number;
  broadcast?: IracingBroadcastPort;
  sim?: IracingSimControl;
  concat?: VideoConcatPort;
  loadSettleMs?: number;
  stopSettleMs?: number;
  simWaitMs?: number;
  minRecordDurationMs?: number;
  shotSettleMs?: number;
};

export function createFsReplayCapture(
  deps: FsReplayCaptureDeps,
): ReplayCapturePort {
  const log = deps.logger.child({ component: "FsReplayCapture" });
  const pollIntervalMs = deps.pollIntervalMs ?? 2_000;
  const broadcast =
    deps.broadcast ?? createPowershellIracingBroadcast({ logger: deps.logger });
  const sim = deps.sim ?? createIracingSimControl({ logger: deps.logger });
  const loadSettleMs = deps.loadSettleMs ?? LOAD_SETTLE_MS;
  const stopSettleMs = deps.stopSettleMs ?? STOP_SETTLE_MS;
  const simWaitMs = deps.simWaitMs ?? SIM_WAIT_MS;
  const minRecordDurationMs = deps.minRecordDurationMs ?? 15_000;
  const shotSettleMs = deps.shotSettleMs ?? 1_000;
  const concat = deps.concat;

  async function waitForNewRecording(
    input: WaitForNewRecordingInput,
  ): Promise<string> {
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
        `iRacing videos folder not found: ${input.watchDir}. Enable video capture in iRacing Options, or set IRACING_VIDEOS_DIR.`,
      );
    }

    const deadline = Date.now() + input.timeoutMs;
    while (Date.now() < deadline) {
      const files = await listVideoFiles(input.watchDir);
      const newest = files
        .filter((file) => file.mtimeMs >= sinceMs && file.size > 0)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
      if (newest) {
        log.info("New replay recording detected", {
          mediaPath: newest.fullPath,
          size: newest.size,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return newest.fullPath;
      }
      await sim.sleep(pollIntervalMs);
    }

    throw new Error(
      `No new recording appeared in ${input.watchDir} within ${Math.round(input.timeoutMs / 1000)}s.`,
    );
  }

  async function autoCapture(input: AutoCaptureInput): Promise<string> {
    const startedAt = performance.now();
    const playSpeed = Math.max(1, Math.min(16, Math.floor(input.playSpeed ?? 1)));
    const recordDurationMs = Math.max(
      minRecordDurationMs,
      input.recordDurationMs ?? DEFAULT_RECORD_MS,
    );
    const since = new Date();

    log.info("Auto-capture started", {
      rpyPath: input.rpyPath,
      watchDir: input.watchDir,
      timeoutMs: input.timeoutMs,
      recordDurationMs,
      playSpeed,
    });

    await fs.access(input.rpyPath);
    await fs.mkdir(input.watchDir, { recursive: true });

    await sim.openReplay(input.rpyPath);
    await sim.waitUntilRunning(Math.min(simWaitMs, input.timeoutMs));
    await sim.sleep(loadSettleMs);

    try {
      await broadcast.send(
        IracingBroadcastMsg.ReplaySearch,
        IracingReplaySearchMode.ToStart,
      );
      await sim.sleep(750);
      await broadcast.send(
        IracingBroadcastMsg.VideoCapture,
        IracingVideoCaptureMode.Start,
      );
      await sim.sleep(500);
      await broadcast.send(
        IracingBroadcastMsg.VideoCapture,
        IracingVideoCaptureMode.HideTimer,
      );
      await broadcast.send(
        IracingBroadcastMsg.ReplaySetPlaySpeed,
        playSpeed,
        0,
      );

      const remainingBudget = Math.max(
        5_000,
        input.timeoutMs - Math.round(performance.now() - startedAt) - stopSettleMs - 5_000,
      );
      const waitMs = Math.min(recordDurationMs, remainingBudget);
      log.info("Recording replay playback", {
        waitMs,
        playSpeed,
      });
      await sim.sleep(waitMs);

      await broadcast.send(
        IracingBroadcastMsg.ReplaySetPlaySpeed,
        0,
        0,
      );
      await broadcast.send(
        IracingBroadcastMsg.VideoCapture,
        IracingVideoCaptureMode.End,
      );
      await sim.sleep(stopSettleMs);
    } catch (error) {
      log.error("Auto-capture control failed", {
        rpyPath: input.rpyPath,
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error),
        durationMs: Math.round(performance.now() - startedAt),
      });
      throw new Error(
        `Automatic iRacing capture failed: ${
          error instanceof Error ? error.message : String(error)
        }. Ensure Options → Enable video and screen capture is ON.`,
        { cause: error },
      );
    }

    const collectTimeout = Math.max(
      10_000,
      Math.min(60_000, input.timeoutMs - Math.round(performance.now() - startedAt)),
    );
    const mediaPath = await waitForNewRecording({
      watchDir: input.watchDir,
      since,
      timeoutMs: collectTimeout,
    });

    log.info("Auto-capture completed", {
      mediaPath,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return mediaPath;
  }

  async function directedCapture(
    input: DirectedCaptureInput,
  ): Promise<DirectedCaptureResult> {
    const startedAt = performance.now();
    const playSpeed = Math.max(1, Math.min(4, Math.floor(input.playSpeed ?? 1)));
    if (input.shots.length === 0) {
      throw new Error("Director capture requires at least one shot");
    }
    if (!concat) {
      throw new Error("Director capture requires a video concat adapter");
    }

    log.info("Directed capture started", {
      rpyPath: input.rpyPath,
      shotCount: input.shots.length,
      watchDir: input.watchDir,
      outputPath: input.outputPath,
      playSpeed,
    });

    await fs.access(input.rpyPath);
    await fs.mkdir(input.watchDir, { recursive: true });
    await fs.mkdir(path.dirname(input.outputPath), { recursive: true });

    await sim.openReplay(input.rpyPath);
    await sim.waitUntilRunning(Math.min(simWaitMs, input.timeoutMs));
    await sim.sleep(loadSettleMs);

    const segments: DirectedCaptureResult["segments"] = [];

    try {
      await broadcast.send(
        IracingBroadcastMsg.VideoCapture,
        IracingVideoCaptureMode.HideTimer,
      );

      for (let index = 0; index < input.shots.length; index += 1) {
        const shot = input.shots[index]!;
        const elapsed = Math.round(performance.now() - startedAt);
        const remainingMs = input.timeoutMs - elapsed;
        const neededMs = shot.recordMs + stopSettleMs + 8_000;
        if (remainingMs < neededMs) {
          log.warn("Directed capture stopping early due to timeout budget", {
            completedShots: segments.length,
            totalShots: input.shots.length,
            remainingMs,
            neededMs,
          });
          break;
        }

        log.info("Director shot starting", {
          shotId: shot.id,
          index,
          seekMs: shot.seekMs,
          recordMs: shot.recordMs,
          carPosition: shot.carPosition,
        });

        if (shot.seekMs < 0) {
          await broadcast.send(
            IracingBroadcastMsg.ReplaySearch,
            IracingReplaySearchMode.NextIncident,
          );
        } else {
          await broadcast.sendWithVar2_32(
            IracingBroadcastMsg.ReplaySearchSessionTime,
            0,
            Math.max(0, Math.floor(shot.seekMs)),
          );
        }
        await sim.sleep(shotSettleMs);
        await broadcast.send(
          IracingBroadcastMsg.CamSwitchPos,
          shot.carPosition,
          shot.cameraGroup,
          shot.cameraNumber,
        );
        await sim.sleep(400);

        const since = new Date();
        await broadcast.send(
          IracingBroadcastMsg.VideoCapture,
          IracingVideoCaptureMode.Start,
        );
        await sim.sleep(300);
        await broadcast.send(
          IracingBroadcastMsg.ReplaySetPlaySpeed,
          playSpeed,
          0,
        );
        await sim.sleep(Math.max(50, shot.recordMs));
        await broadcast.send(
          IracingBroadcastMsg.ReplaySetPlaySpeed,
          0,
          0,
        );
        await broadcast.send(
          IracingBroadcastMsg.VideoCapture,
          IracingVideoCaptureMode.End,
        );
        await sim.sleep(stopSettleMs);

        const segmentPath = await waitForNewRecording({
          watchDir: input.watchDir,
          since,
          timeoutMs: 45_000,
        });
        segments.push({
          shotId: shot.id,
          path: segmentPath,
          durationMs: shot.recordMs,
        });
      }
    } catch (error) {
      log.error("Directed capture failed", {
        rpyPath: input.rpyPath,
        completedShots: segments.length,
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error),
        durationMs: Math.round(performance.now() - startedAt),
      });
      throw new Error(
        `Director capture failed after ${segments.length} shot(s): ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }

    if (segments.length === 0) {
      throw new Error("Director capture produced no segments");
    }

    const mediaPath = await concat.concat({
      segmentPaths: segments.map((segment) => segment.path),
      outputPath: input.outputPath,
    });

    log.info("Directed capture completed", {
      mediaPath,
      segmentCount: segments.length,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return { mediaPath, segments };
  }

  return {
    defaultVideosDir() {
      if (deps.videosDir) return deps.videosDir;
      return path.join(os.homedir(), "Documents", "iRacing", "videos");
    },
    waitForNewRecording,
    autoCapture,
    directedCapture,
  };
}
