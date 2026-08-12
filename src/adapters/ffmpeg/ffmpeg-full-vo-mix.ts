import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  duckedVoiceMixFilter,
  filterFilename,
} from "@/src/adapters/ffmpeg/ffmpeg-audio-filters";
import {
  resolveVideoEncoder,
  type VideoEncoderPreference,
} from "@/src/adapters/ffmpeg/ffmpeg-encoder";
import {
  DEFAULT_MAX_MBPS,
  DEFAULT_TARGET_MBPS,
  deliveryEncoderArgs,
} from "@/src/adapters/ffmpeg/ffmpeg-full-video-encode";
import type {
  AudioConcatInput,
  AudioConcatPort,
  AudioConcatResult,
  FullVoMixInput,
  FullVoMixPort,
  FullVoMixResult,
} from "@/src/ports/full-vo-mix";
import type { Logger } from "@/src/ports/logger";
import type { SettingsRepository } from "@/src/ports/settings-repository";

type Deps = {
  logger: Logger;
  settings?: SettingsRepository;
  ffmpegPath?: string;
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

async function runFfmpeg(
  executable: string,
  args: string[],
  log: Logger,
  operation: string,
): Promise<number> {
  const startedAt = performance.now();
  log.info("Full VO ffmpeg started", { operation, argCount: args.length });
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
      if (code === 0) {
        resolve();
        return;
      }
      log.error("Full VO ffmpeg failed", {
        operation,
        code,
        durationMs: Math.round(performance.now() - startedAt),
        stderr: stderr.trim(),
      });
      reject(
        new Error(
          `Full VO ffmpeg (${operation}) exited with code ${code}: ${stderr.trim()}`,
        ),
      );
    });
  });
  const durationMs = Math.round(performance.now() - startedAt);
  log.info("Full VO ffmpeg completed", { operation, durationMs });
  return durationMs;
}

/** Concat demuxer entries quote the path and escape embedded quotes. */
function concatListEntry(filePath: string): string {
  return `file '${path.resolve(filePath).replaceAll("\\", "/").replaceAll("'", "'\\''")}'`;
}

export function createFfmpegFullVoMix(
  deps: Deps,
): FullVoMixPort & AudioConcatPort {
  const ffmpegPath = deps.ffmpegPath ?? "ffmpeg";
  const log = deps.logger.child({ component: "FfmpegFullVoMix" });

  return {
    async concat(input: AudioConcatInput): Promise<AudioConcatResult> {
      const startedAt = performance.now();
      if (input.inputPaths.length === 0) {
        throw new Error("Voice-over concat requires at least one chunk");
      }
      if (input.inputPaths.length === 1) {
        log.info("Voice-over concat skipped for single chunk", {
          outputPath: input.inputPaths[0],
        });
        return {
          outputPath: input.inputPaths[0]!,
          durationMs: Math.round(performance.now() - startedAt),
        };
      }

      const outputPath = path.resolve(input.outputPath);
      const parsed = path.parse(outputPath);
      const listPath = path.join(parsed.dir, `${parsed.name}-concat.txt`);
      await fs.mkdir(parsed.dir, { recursive: true });
      await fs.writeFile(
        listPath,
        `${input.inputPaths.map(concatListEntry).join("\n")}\n`,
        "utf8",
      );
      log.info("Concatenating voice-over chunks", {
        chunkCount: input.inputPaths.length,
        outputPath,
      });

      try {
        await runFfmpeg(
          ffmpegPath,
          [
            "-y",
            "-hide_banner",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            listPath,
            "-c",
            "copy",
            outputPath,
          ],
          log,
          "concat",
        );
      } finally {
        await fs.rm(listPath, { force: true });
      }

      const durationMs = Math.round(performance.now() - startedAt);
      log.info("Voice-over chunks concatenated", {
        chunkCount: input.inputPaths.length,
        outputPath,
        durationMs,
      });
      return { outputPath, durationMs };
    },

    async mix(input: FullVoMixInput): Promise<FullVoMixResult> {
      const startedAt = performance.now();
      const videoPath = path.resolve(input.videoPath);
      const voiceAudioPath = path.resolve(input.voiceAudioPath);
      const outputPath = path.resolve(input.outputPath);
      const burnedInCaptions = Boolean(
        input.burnInCaptions && input.subtitlesPath,
      );
      if (input.burnInCaptions && !input.subtitlesPath) {
        log.warn("Caption burn-in requested without a subtitle file", {
          outputPath,
        });
      }

      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      // Stream-copying the picture keeps a 40-minute race mix at audio speed;
      // burn-in is the only path that pays for a full re-encode.
      const videoArgs = burnedInCaptions
        ? [
            "-vf",
            `subtitles=filename='${filterFilename(input.subtitlesPath!)}'`,
            ...deliveryEncoderArgs(
              resolveVideoEncoder(ffmpegPath, await resolvePreference(deps))
                .codec,
              DEFAULT_TARGET_MBPS,
              DEFAULT_MAX_MBPS,
            ),
          ]
        : ["-c:v", "copy"];

      log.info("Mixing voice-over onto full-race delivery encode", {
        videoPath,
        voiceAudioPath,
        outputPath,
        burnedInCaptions,
        voiceDuckDb: input.voiceDuckDb ?? null,
      });

      await runFfmpeg(
        ffmpegPath,
        [
          "-y",
          "-hide_banner",
          "-i",
          videoPath,
          "-i",
          voiceAudioPath,
          "-filter_complex",
          duckedVoiceMixFilter({
            sourceAudioLabel: "0:a",
            voiceAudioLabel: "1:a",
            voiceDuckDb: input.voiceDuckDb,
          }).join(";"),
          "-map",
          "0:v",
          "-map",
          "[aout]",
          ...videoArgs,
          "-c:a",
          "aac",
          "-b:a",
          "320k",
          "-ac",
          "2",
          "-movflags",
          "+faststart",
          outputPath,
        ],
        log,
        "mix",
      );

      const durationMs = Math.round(performance.now() - startedAt);
      log.info("Full-race voice-over mix ready", {
        outputPath,
        burnedInCaptions,
        durationMs,
      });
      return { outputPath, burnedInCaptions, durationMs };
    },
  };
}
