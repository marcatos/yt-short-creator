import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import type { Logger } from "@/src/ports/logger";
import type { RenderInput, RenderPort } from "@/src/ports/render";

import { resolveVideoEncoder } from "./ffmpeg-encoder";

type FfmpegRenderDeps = {
  logger: Logger;
  ffmpegPath?: string;
  /** Override auto-detected encoder codec, e.g. h264_nvenc or libx264. */
  videoCodec?: string;
};

const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;

function seconds(milliseconds: number): string {
  return (milliseconds / 1_000).toFixed(3);
}

function accentForFilter(value: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`Invalid brand accent color: ${value}`);
  }
  return `0x${value.slice(1)}`;
}

function scaleAndCrop(label: string, focusX = 0.5): string {
  const normalizedFocus = Math.min(1, Math.max(0, focusX));
  return (
    `[${label}]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:` +
    "force_original_aspect_ratio=increase," +
    `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(iw-ow)*${normalizedFocus}:(ih-oh)/2,` +
    "setsar=1"
  );
}

function clipArgs(input: RenderInput): string[] {
  if (input.startMs === undefined || input.endMs === undefined) {
    throw new Error("Clip render requires startMs and endMs");
  }
  if (input.endMs <= input.startMs) {
    throw new Error("Clip render endMs must be greater than startMs");
  }

  const durationMs = input.endMs - input.startMs;
  const filter =
    `${scaleAndCrop("0:v", input.crop?.focusX)}[base];` +
    `[base]drawbox=x=0:y=0:w=18:h=ih:color=${accentForFilter(input.accentColor)}:t=fill[accent];` +
    "[1:v]scale=240:-2[logo];" +
    "[accent][logo]overlay=W-w-48:48:format=auto[outv]";

  return [
    "-ss",
    seconds(input.startMs),
    "-t",
    seconds(durationMs),
    "-i",
    input.sourceMediaPath,
    "-loop",
    "1",
    "-i",
    input.logoPath,
    "-filter_complex",
    filter,
    "-map",
    "[outv]",
    "-map",
    "0:a?",
    "-t",
    seconds(durationMs),
  ];
}

function generateArgs(input: RenderInput): string[] {
  if (!input.timeline?.length || !input.voiceAssetPath) {
    throw new Error("Generate render requires a timeline and voiceAssetPath");
  }

  const timeline = [...input.timeline].sort(
    (left, right) => left.startMs - right.startMs,
  );
  const args: string[] = [];
  const segments: string[] = [];
  const concatInputs: string[] = [];

  timeline.forEach((entry, index) => {
    const durationMs = entry.endMs - entry.startMs;
    if (durationMs <= 0) {
      throw new Error(`Timeline entry ${index} has an invalid duration`);
    }
    args.push(
      "-stream_loop",
      "-1",
      "-t",
      seconds(durationMs),
      "-i",
      entry.asset,
    );
    segments.push(
      `${scaleAndCrop(`${index}:v`)},trim=duration=${seconds(durationMs)},setpts=PTS-STARTPTS[v${index}]`,
    );
    concatInputs.push(`[v${index}]`);
  });

  const logoIndex = timeline.length;
  const voiceIndex = timeline.length + 1;
  args.push("-loop", "1", "-i", input.logoPath, "-i", input.voiceAssetPath);
  segments.push(
    `${concatInputs.join("")}concat=n=${timeline.length}:v=1:a=0[base]`,
    `[base]drawbox=x=0:y=0:w=18:h=ih:color=${accentForFilter(input.accentColor)}:t=fill[accent]`,
    `[${logoIndex}:v]scale=240:-2[logo]`,
    "[accent][logo]overlay=W-w-48:48:format=auto[outv]",
  );

  return [
    ...args,
    "-filter_complex",
    segments.join(";"),
    "-map",
    "[outv]",
    "-map",
    `${voiceIndex}:a:0`,
    "-shortest",
  ];
}

async function runFfmpeg(
  executable: string,
  args: string[],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-8_000);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`FFmpeg exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

export function createFfmpegRender(deps: FfmpegRenderDeps): RenderPort {
  const ffmpegPath = deps.ffmpegPath ?? "ffmpeg";
  const logger = deps.logger.child({ component: "FfmpegRender" });
  const videoCodec =
    deps.videoCodec ?? process.env.FFMPEG_VIDEO_ENCODER ?? undefined;

  return {
    async render(input) {
      const startedAt = performance.now();
      const encoder = resolveVideoEncoder(ffmpegPath, videoCodec);
      logger.info("FFmpeg render started", {
        candidateId: input.candidateId,
        origin: input.origin,
        outputPath: input.outputPath,
        videoEncoder: encoder.codec,
        videoEncoderLabel: encoder.label,
      });

      try {
        await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
        const mediaArgs =
          input.origin === "clip" ? clipArgs(input) : generateArgs(input);
        await runFfmpeg(ffmpegPath, [
          "-y",
          "-hide_banner",
          ...mediaArgs,
          ...encoder.args,
          "-r",
          "30",
          "-c:a",
          "aac",
          "-movflags",
          "+faststart",
          input.outputPath,
        ]);

        logger.info("FFmpeg render completed", {
          candidateId: input.candidateId,
          outputPath: input.outputPath,
          videoEncoder: encoder.codec,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return { outputPath: input.outputPath };
      } catch (error) {
        logger.error("FFmpeg render failed", {
          candidateId: input.candidateId,
          outputPath: input.outputPath,
          videoEncoder: encoder.codec,
          durationMs: Math.round(performance.now() - startedAt),
          error: error instanceof Error ? error.stack : String(error),
        });
        throw error;
      }
    },
  };
}
