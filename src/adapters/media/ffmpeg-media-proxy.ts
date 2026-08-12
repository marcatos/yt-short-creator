import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import type {
  EnsureMediaProxyInput,
  MediaProxyPort,
  MediaProxyResult,
  ProxyFrame,
} from "@/src/ports/media-proxy";
import type { Logger } from "@/src/ports/logger";

import { probeMediaDurationSec } from "./ffprobe-duration";

const MANIFEST_NAME = "proxy-manifest.json";
const PROXY_VIDEO_NAME = "proxy.mp4";
const AUDIO_NAME = "audio.mp3";
const FRAMES_DIR_NAME = "frames";

type Manifest = {
  sourcePath: string;
  sourceMtimeMs: number;
  frameIntervalSec: number;
  durationSec: number;
  frames: ProxyFrame[];
};

type FfmpegMediaProxyDeps = {
  logger: Logger;
  ffmpegPath?: string;
  ffprobePath?: string;
};

async function runCommand(
  executable: string,
  args: string[],
  log: Logger,
  label: string,
): Promise<void> {
  const startedAt = performance.now();
  log.info(`${label} started`, { executable, argCount: args.length });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-12_000);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      const durationMs = Math.round(performance.now() - startedAt);
      if (code === 0) {
        log.info(`${label} completed`, { durationMs });
        resolve();
        return;
      }
      log.error(`${label} failed`, { code, durationMs, stderr: stderr.trim() });
      reject(new Error(`${label} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

async function fileMtimeMs(filePath: string): Promise<number> {
  const stat = await fs.stat(filePath);
  return stat.mtimeMs;
}

async function readManifest(outDir: string): Promise<Manifest | null> {
  try {
    const raw = await fs.readFile(path.join(outDir, MANIFEST_NAME), "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

async function writeManifest(outDir: string, manifest: Manifest): Promise<void> {
  await fs.writeFile(
    path.join(outDir, MANIFEST_NAME),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
}

async function listFrames(
  framesDir: string,
  frameIntervalSec: number,
): Promise<ProxyFrame[]> {
  const entries = await fs.readdir(framesDir);
  const frames: ProxyFrame[] = [];
  for (const name of entries) {
    const match = /^frame_(\d+)\.jpg$/i.exec(name);
    if (!match) continue;
    const index = Number(match[1]);
    if (!Number.isFinite(index) || index < 1) continue;
    // ffmpeg fps=1/N names starting at 1 for t≈0.
    const timeMs = Math.round((index - 1) * frameIntervalSec * 1_000);
    frames.push({ timeMs, path: path.join(framesDir, name) });
  }
  frames.sort((a, b) => a.timeMs - b.timeMs);
  return frames;
}

export function createFfmpegMediaProxy(
  deps: FfmpegMediaProxyDeps,
): MediaProxyPort {
  const ffmpegPath = deps.ffmpegPath ?? "ffmpeg";
  const ffprobePath = deps.ffprobePath ?? "ffprobe";
  const log = deps.logger.child({ component: "FfmpegMediaProxy" });

  return {
    async ensureProxy(input: EnsureMediaProxyInput): Promise<MediaProxyResult> {
      const startedAt = performance.now();
      const frameIntervalSec = input.frameIntervalSec ?? 2;
      const mediaPath = path.resolve(input.mediaPath);
      const outDir = path.resolve(input.outDir);
      const proxyVideoPath = path.join(outDir, PROXY_VIDEO_NAME);
      const audioPath = path.join(outDir, AUDIO_NAME);
      const framesDir = path.join(outDir, FRAMES_DIR_NAME);

      await fs.mkdir(framesDir, { recursive: true });
      const sourceMtimeMs = await fileMtimeMs(mediaPath);
      const existing = await readManifest(outDir);

      if (
        existing &&
        existing.sourcePath === mediaPath &&
        existing.sourceMtimeMs === sourceMtimeMs &&
        existing.frameIntervalSec === frameIntervalSec
      ) {
        try {
          await fs.access(proxyVideoPath);
          await fs.access(audioPath);
          const frames =
            existing.frames.length > 0
              ? existing.frames
              : await listFrames(framesDir, frameIntervalSec);
          if (frames.length > 0) {
            log.info("Reusing existing media proxy", {
              outDir,
              frameCount: frames.length,
              durationMs: Math.round(performance.now() - startedAt),
            });
            return {
              proxyVideoPath,
              audioPath,
              framesDir,
              frames,
              durationSec: existing.durationSec,
              reused: true,
            };
          }
        } catch {
          log.warn("Proxy manifest present but artifacts missing; rebuilding", {
            outDir,
          });
        }
      }

      log.info("Building media proxy", {
        mediaPath,
        outDir,
        frameIntervalSec,
      });

      const durationSec = await probeMediaDurationSec(mediaPath, ffprobePath);

      // Analysis only needs audio + sampled frames. Skip a full proxy re-encode
      // of huge OBS masters (often 100+ Mbps) — that path is optional/cached later.
      await runCommand(
        ffmpegPath,
        [
          "-y",
          "-hide_banner",
          "-i",
          mediaPath,
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "libmp3lame",
          "-b:a",
          "64k",
          audioPath,
        ],
        log,
        "ffmpeg proxy audio",
      );

      const prior = await fs.readdir(framesDir);
      await Promise.all(
        prior.map((name) =>
          fs.unlink(path.join(framesDir, name)).catch(() => undefined),
        ),
      );

      // Even dimensions required by libx264/jpeg pipelines (853x480 fails).
      const frameVf = [
        `fps=1/${frameIntervalSec}`,
        "scale=854:480:force_original_aspect_ratio=decrease",
        "pad=854:480:(ow-iw)/2:(oh-ih)/2",
      ].join(",");

      await runCommand(
        ffmpegPath,
        [
          "-y",
          "-hide_banner",
          "-i",
          mediaPath,
          "-vf",
          frameVf,
          "-q:v",
          "5",
          path.join(framesDir, "frame_%06d.jpg"),
        ],
        log,
        "ffmpeg proxy frames",
      );

      // Lightweight scrub proxy from already-decoded low-rate frames path:
      // build a tiny mp4 from the JPEGs so callers still get a proxyVideoPath.
      await runCommand(
        ffmpegPath,
        [
          "-y",
          "-hide_banner",
          "-framerate",
          String(1 / frameIntervalSec),
          "-i",
          path.join(framesDir, "frame_%06d.jpg"),
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "32",
          "-pix_fmt",
          "yuv420p",
          "-an",
          proxyVideoPath,
        ],
        log,
        "ffmpeg proxy video",
      );

      const frames = await listFrames(framesDir, frameIntervalSec);
      const manifest: Manifest = {
        sourcePath: mediaPath,
        sourceMtimeMs,
        frameIntervalSec,
        durationSec,
        frames,
      };
      await writeManifest(outDir, manifest);

      log.info("Media proxy ready", {
        outDir,
        frameCount: frames.length,
        durationSec,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return {
        proxyVideoPath,
        audioPath,
        framesDir,
        frames,
        durationSec,
        reused: false,
      };
    },
  };
}
