import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  resolveVideoEncoder,
  type VideoEncoderPreference,
} from "@/src/adapters/ffmpeg/ffmpeg-encoder";
import { probeMediaDurationSec } from "@/src/adapters/media/ffprobe-duration";
import type {
  FullVideoEncodeInput,
  FullVideoEncodePort,
  FullVideoEncodeResult,
} from "@/src/ports/full-video-encode";
import type { Logger } from "@/src/ports/logger";
import type { SettingsRepository } from "@/src/ports/settings-repository";

const MANIFEST_NAME = "full-encode-manifest.json";

/** YouTube recommended ~24 Mbps for 1440p60; we target slightly under with CQ. */
const DEFAULT_TARGET_MBPS = 20;
const DEFAULT_MAX_MBPS = 24;
const DEFAULT_MAX_WIDTH = 2560;

type Manifest = {
  sourcePath: string;
  sourceMtimeMs: number;
  targetBitrateMbps: number;
  maxBitrateMbps: number;
  maxWidth: number;
  width: number;
  height: number;
  fps: number;
  encoderLabel: string;
};

type Deps = {
  logger: Logger;
  settings?: SettingsRepository;
  ffmpegPath?: string;
  ffprobePath?: string;
  videoEncoderPreference?: VideoEncoderPreference;
};

function preferenceFromEnv(): VideoEncoderPreference | undefined {
  const raw = process.env.FFMPEG_VIDEO_ENCODER?.trim();
  if (
    raw === "auto_igpu" ||
    raw === "auto_dgpu" ||
    raw === "h264_qsv" ||
    raw === "h264_nvenc" ||
    raw === "h264_amf" ||
    raw === "h264_mf" ||
    raw === "libx264"
  ) {
    return raw;
  }
  return undefined;
}

async function resolvePreference(deps: Deps): Promise<VideoEncoderPreference> {
  if (deps.videoEncoderPreference) return deps.videoEncoderPreference;
  const fromEnv = preferenceFromEnv();
  if (fromEnv) return fromEnv;
  if (deps.settings) {
    const settings = await deps.settings.get();
    return settings.videoEncoderPreference;
  }
  return "auto_dgpu";
}

function deliveryEncoderArgs(
  codec: string,
  targetMbps: number,
  maxMbps: number,
): string[] {
  const bitrate = `${targetMbps}M`;
  const maxrate = `${maxMbps}M`;
  const bufsize = `${maxMbps * 2}M`;

  switch (codec) {
    case "h264_nvenc":
      return [
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p5",
        "-rc",
        "vbr",
        "-cq",
        "19",
        "-b:v",
        bitrate,
        "-maxrate",
        maxrate,
        "-bufsize",
        bufsize,
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
      ];
    case "h264_qsv":
      return [
        "-c:v",
        "h264_qsv",
        "-preset",
        "medium",
        "-global_quality",
        "20",
        "-b:v",
        bitrate,
        "-maxrate",
        maxrate,
        "-bufsize",
        bufsize,
        "-pix_fmt",
        "yuv420p",
      ];
    case "h264_amf":
      return [
        "-c:v",
        "h264_amf",
        "-quality",
        "quality",
        "-rc",
        "vbr_latency",
        "-b:v",
        bitrate,
        "-maxrate",
        maxrate,
        "-bufsize",
        bufsize,
        "-pix_fmt",
        "yuv420p",
      ];
    case "h264_mf":
      return [
        "-c:v",
        "h264_mf",
        "-b:v",
        bitrate,
        "-maxrate",
        maxrate,
        "-bufsize",
        bufsize,
        "-pix_fmt",
        "yuv420p",
      ];
    default:
      return [
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-maxrate",
        maxrate,
        "-bufsize",
        bufsize,
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
      ];
  }
}

async function runFfmpeg(
  executable: string,
  args: string[],
  log: Logger,
): Promise<void> {
  const startedAt = performance.now();
  log.info("Full-video ffmpeg started", { argCount: args.length });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-16_000);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      const durationMs = Math.round(performance.now() - startedAt);
      if (code === 0) {
        log.info("Full-video ffmpeg completed", { durationMs });
        resolve();
        return;
      }
      log.error("Full-video ffmpeg failed", {
        code,
        durationMs,
        stderr: stderr.trim(),
      });
      reject(
        new Error(`Full-video ffmpeg exited with code ${code}: ${stderr.trim()}`),
      );
    });
  });
}

async function probeGeometry(
  ffprobePath: string,
  mediaPath: string,
): Promise<{ width: number; height: number; fps: number }> {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    ffprobePath,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,avg_frame_rate",
      "-of",
      "json",
      mediaPath,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(`ffprobe failed for ${mediaPath}: ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as {
    streams?: Array<{
      width?: number;
      height?: number;
      avg_frame_rate?: string;
    }>;
  };
  const stream = parsed.streams?.[0];
  if (!stream?.width || !stream.height) {
    throw new Error(`No video stream geometry for ${mediaPath}`);
  }
  let fps = 60;
  const rate = stream.avg_frame_rate ?? "60/1";
  const [num, den] = rate.split("/").map(Number);
  if (num && den) fps = Math.round(num / den);
  return { width: stream.width, height: stream.height, fps };
}

function scaleFilter(sourceWidth: number, maxWidth: number): string | null {
  if (sourceWidth <= maxWidth) return null;
  // Even dimensions for H.264.
  return `scale=${maxWidth}:-2:flags=lanczos`;
}

export function createFfmpegFullVideoEncode(
  deps: Deps,
): FullVideoEncodePort {
  const ffmpegPath = deps.ffmpegPath ?? "ffmpeg";
  const ffprobePath = deps.ffprobePath ?? "ffprobe";
  const log = deps.logger.child({ component: "FfmpegFullVideoEncode" });

  return {
    async encode(input: FullVideoEncodeInput): Promise<FullVideoEncodeResult> {
      const startedAt = performance.now();
      const sourceMediaPath = path.resolve(input.sourceMediaPath);
      const outputPath = path.resolve(input.outputPath);
      const targetBitrateMbps = input.targetBitrateMbps ?? DEFAULT_TARGET_MBPS;
      const maxBitrateMbps = input.maxBitrateMbps ?? DEFAULT_MAX_MBPS;
      const maxWidth = input.maxWidth ?? DEFAULT_MAX_WIDTH;
      const outDir = path.dirname(outputPath);
      const manifestPath = path.join(outDir, MANIFEST_NAME);

      await fs.mkdir(outDir, { recursive: true });
      const sourceStat = await fs.stat(sourceMediaPath);

      try {
        const raw = await fs.readFile(manifestPath, "utf8");
        const manifest = JSON.parse(raw) as Manifest;
        await fs.access(outputPath);
        if (
          manifest.sourcePath === sourceMediaPath &&
          manifest.sourceMtimeMs === sourceStat.mtimeMs &&
          manifest.targetBitrateMbps === targetBitrateMbps &&
          manifest.maxBitrateMbps === maxBitrateMbps &&
          manifest.maxWidth === maxWidth
        ) {
          log.info("Reusing existing YouTube delivery encode", {
            outputPath,
            durationMs: Math.round(performance.now() - startedAt),
          });
          return {
            outputPath,
            reused: true,
            width: manifest.width,
            height: manifest.height,
            fps: manifest.fps,
            videoBitrateMbps: targetBitrateMbps,
            encoderLabel: manifest.encoderLabel,
            durationMs: Math.round(performance.now() - startedAt),
          };
        }
      } catch {
        // rebuild
      }

      const geometry = await probeGeometry(ffprobePath, sourceMediaPath);
      const durationSec = await probeMediaDurationSec(
        sourceMediaPath,
        ffprobePath,
      );
      const preference = await resolvePreference(deps);
      const baseEncoder = resolveVideoEncoder(ffmpegPath, preference);
      const encoderArgs = deliveryEncoderArgs(
        baseEncoder.codec,
        targetBitrateMbps,
        maxBitrateMbps,
      );
      const vf = scaleFilter(geometry.width, maxWidth);
      const outWidth =
        geometry.width > maxWidth ? maxWidth : geometry.width - (geometry.width % 2);
      const outHeight =
        geometry.width > maxWidth
          ? Math.round((geometry.height * maxWidth) / geometry.width / 2) * 2
          : geometry.height - (geometry.height % 2);

      log.info("Encoding full race for YouTube delivery", {
        sourceMediaPath,
        outputPath,
        sourceMbpsEstimate: null,
        targetBitrateMbps,
        maxBitrateMbps,
        source: geometry,
        encoder: baseEncoder.label,
        durationSec,
      });

      const args = [
        "-y",
        "-hide_banner",
        "-hwaccel",
        "auto",
        "-i",
        sourceMediaPath,
        ...(vf ? ["-vf", vf] : []),
        ...encoderArgs,
        "-r",
        String(Math.min(60, Math.max(30, geometry.fps || 60))),
        "-c:a",
        "aac",
        "-b:a",
        "320k",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        outputPath,
      ];

      await runFfmpeg(ffmpegPath, args, log);

      const manifest: Manifest = {
        sourcePath: sourceMediaPath,
        sourceMtimeMs: sourceStat.mtimeMs,
        targetBitrateMbps,
        maxBitrateMbps,
        maxWidth,
        width: outWidth,
        height: outHeight,
        fps: Math.min(60, Math.max(30, geometry.fps || 60)),
        encoderLabel: baseEncoder.label,
      };
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

      const durationMs = Math.round(performance.now() - startedAt);
      log.info("Full-video encode ready", {
        outputPath,
        encoderLabel: baseEncoder.label,
        targetBitrateMbps,
        durationMs,
      });

      return {
        outputPath,
        reused: false,
        width: outWidth,
        height: outHeight,
        fps: manifest.fps,
        videoBitrateMbps: targetBitrateMbps,
        encoderLabel: baseEncoder.label,
        durationMs,
      };
    },
  };
}
