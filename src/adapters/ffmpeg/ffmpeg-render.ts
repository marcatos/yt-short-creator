import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import { JobCancelledError } from "@/src/domain/queue-control";
import type { Logger } from "@/src/ports/logger";
import type { RenderInput, RenderPort } from "@/src/ports/render";
import type {
  SettingsRepository,
  VideoEncoderPreference,
} from "@/src/ports/settings-repository";

import { resolveVideoEncoder } from "./ffmpeg-encoder";

type FfmpegRenderDeps = {
  logger: Logger;
  ffmpegPath?: string;
  settings?: SettingsRepository;
  /** Override settings / env when set (mainly for tests). */
  videoEncoderPreference?: VideoEncoderPreference;
};

function preferenceFromEnv(): VideoEncoderPreference | undefined {
  const raw = process.env.FFMPEG_VIDEO_ENCODER?.trim();
  if (!raw) return undefined;
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

async function resolvePreference(
  deps: FfmpegRenderDeps,
): Promise<VideoEncoderPreference> {
  if (deps.videoEncoderPreference) return deps.videoEncoderPreference;
  const fromEnv = preferenceFromEnv();
  if (fromEnv) return fromEnv;
  if (deps.settings) {
    const settings = await deps.settings.get();
    return settings.videoEncoderPreference;
  }
  return "auto_igpu";
}

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

function assFilenameForFilter(filePath: string): string {
  return filePath
    .replaceAll("\\", "/")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'");
}

function voiceDuckVolume(db: number | undefined): string {
  const normalizedDb = db !== undefined && Number.isFinite(db) ? db : -12;
  return Math.pow(10, normalizedDb / 20).toFixed(6);
}

function brandedVideoFilter(
  input: RenderInput,
  baseLabel: string,
  logoLabel: string,
): string[] {
  const outputLabel =
    input.burnInCaptions && input.assPath ? "branded" : "outv";
  const filters = [
    `[${baseLabel}]drawbox=x=0:y=0:w=18:h=ih:color=${accentForFilter(input.accentColor)}:t=fill[accent]`,
    `[${logoLabel}]scale=240:-2[logo]`,
    `[accent][logo]overlay=W-w-48:48:format=auto[${outputLabel}]`,
  ];
  if (input.burnInCaptions && input.assPath) {
    filters.push(
      `[branded]ass=filename='${assFilenameForFilter(input.assPath)}'[outv]`,
    );
  }
  return filters;
}

function voiceMixFilter(
  input: RenderInput,
  gameAudioLabel: string,
  voiceInputIndex: number,
): string[] {
  if (!input.voiceAssetPath) return [];
  return [
    `[${gameAudioLabel}]volume=${voiceDuckVolume(input.voiceDuckDb)}[ga]`,
    `[${voiceInputIndex}:a]volume=1[va]`,
    "[ga][va]amix=inputs=2:duration=first:dropout_transition=0[aout]",
  ];
}

function clipArgs(input: RenderInput): string[] {
  if (input.segments && input.segments.length >= 2) {
    return multiSegmentClipArgs(input);
  }

  if (input.startMs === undefined || input.endMs === undefined) {
    throw new Error("Clip render requires startMs and endMs");
  }
  if (input.endMs <= input.startMs) {
    throw new Error("Clip render endMs must be greater than startMs");
  }

  const durationMs = input.endMs - input.startMs;
  const filterParts = [
    `${scaleAndCrop("0:v", input.crop?.focusX)}[base]`,
    ...brandedVideoFilter(input, "base", "1:v"),
  ];
  if (input.voiceAssetPath) {
    filterParts.push(...voiceMixFilter(input, "0:a", 2));
  }

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
    ...(input.voiceAssetPath ? ["-i", input.voiceAssetPath] : []),
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[outv]",
    "-map",
    input.voiceAssetPath ? "[aout]" : "0:a?",
    "-t",
    seconds(durationMs),
  ];
}

function multiSegmentClipArgs(input: RenderInput): string[] {
  const segments = input.segments ?? [];
  if (segments.length < 2) {
    throw new Error("Multi-segment render requires at least 2 segments");
  }

  const args: string[] = [];
  const filterParts: string[] = [];
  const videoConcat: string[] = [];
  const audioConcat: string[] = [];

  segments.forEach((segment, index) => {
    const durationMs = segment.endMs - segment.startMs;
    if (durationMs <= 0) {
      throw new Error(`Segment ${index} has invalid duration`);
    }
    args.push(
      "-ss",
      seconds(segment.startMs),
      "-t",
      seconds(durationMs),
      "-i",
      input.sourceMediaPath,
    );
    filterParts.push(
      `${scaleAndCrop(`${index}:v`, input.crop?.focusX)},` +
        `trim=duration=${seconds(durationMs)},setpts=PTS-STARTPTS[v${index}]`,
    );
    filterParts.push(
      `[${index}:a]atrim=duration=${seconds(durationMs)},asetpts=PTS-STARTPTS[a${index}]`,
    );
    videoConcat.push(`[v${index}]`);
    audioConcat.push(`[a${index}]`);
  });

  const logoIndex = segments.length;
  args.push("-loop", "1", "-i", input.logoPath);
  const voiceIndex = logoIndex + 1;
  if (input.voiceAssetPath) {
    args.push("-i", input.voiceAssetPath);
  }

  filterParts.push(
    `${videoConcat.join("")}concat=n=${segments.length}:v=1:a=0[vcat]`,
  );
  filterParts.push(
    `${audioConcat.join("")}concat=n=${segments.length}:v=0:a=1[acat]`,
  );
  filterParts.push(
    ...brandedVideoFilter(input, "vcat", `${logoIndex}:v`),
    ...voiceMixFilter(input, "acat", voiceIndex),
  );

  return [
    ...args,
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[outv]",
    "-map",
    input.voiceAssetPath ? "[aout]" : "[acat]",
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
    ...brandedVideoFilter(input, "base", `${logoIndex}:v`),
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

function bindAbort(
  signal: AbortSignal | undefined,
  child: ChildProcess,
  onAbort: () => void,
): () => void {
  if (!signal) return () => undefined;

  const cleanup = () => signal.removeEventListener("abort", handleAbort);
  const handleAbort = () => {
    child.kill("SIGTERM");
    onAbort();
  };

  if (signal.aborted) {
    handleAbort();
    return cleanup;
  }

  signal.addEventListener("abort", handleAbort, { once: true });
  child.once("close", cleanup);
  return cleanup;
}

async function runFfmpeg(
  executable: string,
  args: string[],
  signal?: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    let settled = false;
    let removeAbort: () => void = () => undefined;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      removeAbort();
      callback();
    };
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-8_000);
    });
    child.once("error", (error) => {
      settle(() =>
        reject(signal?.aborted ? new JobCancelledError() : error),
      );
    });
    child.once("close", (code) => {
      if (signal?.aborted) {
        settle(() => reject(new JobCancelledError()));
        return;
      }
      if (code === 0) {
        settle(resolve);
        return;
      }
      settle(() =>
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.trim()}`)),
      );
    });
    removeAbort = bindAbort(signal, child, () => {
      settle(() => reject(new JobCancelledError()));
    });
  });
}

export function createFfmpegRender(deps: FfmpegRenderDeps): RenderPort {
  const ffmpegPath = deps.ffmpegPath ?? "ffmpeg";
  const logger = deps.logger.child({ component: "FfmpegRender" });

  return {
    async render(input, options) {
      const startedAt = performance.now();
      if (options?.signal?.aborted) {
        throw new JobCancelledError();
      }
      const preference = await resolvePreference(deps);
      const encoder = resolveVideoEncoder(ffmpegPath, preference);
      logger.info("FFmpeg render started", {
        candidateId: input.candidateId,
        origin: input.origin,
        outputPath: input.outputPath,
        videoEncoderPreference: preference,
        videoEncoder: encoder.codec,
        videoEncoderLabel: encoder.label,
        hasVoiceOver: Boolean(input.voiceAssetPath),
        burnsAssCaptions: Boolean(input.burnInCaptions && input.assPath),
      });

      try {
        await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
        if (options?.signal?.aborted) {
          throw new JobCancelledError();
        }
        const mediaArgs =
          input.origin === "generate" ? generateArgs(input) : clipArgs(input);
        await runFfmpeg(
          ffmpegPath,
          [
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
          ],
          options?.signal,
        );

        logger.info("FFmpeg render completed", {
          candidateId: input.candidateId,
          outputPath: input.outputPath,
          videoEncoderPreference: preference,
          videoEncoder: encoder.codec,
          hasVoiceOver: Boolean(input.voiceAssetPath),
          burnsAssCaptions: Boolean(input.burnInCaptions && input.assPath),
          durationMs: Math.round(performance.now() - startedAt),
        });
        return { outputPath: input.outputPath };
      } catch (error) {
        logger.error("FFmpeg render failed", {
          candidateId: input.candidateId,
          outputPath: input.outputPath,
          videoEncoderPreference: preference,
          videoEncoder: encoder.codec,
          durationMs: Math.round(performance.now() - startedAt),
          error: error instanceof Error ? error.stack : String(error),
        });
        throw error;
      }
    },
  };
}
