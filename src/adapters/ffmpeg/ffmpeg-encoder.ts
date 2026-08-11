import { spawnSync } from "node:child_process";

export type VideoEncoderPreference =
  | "auto_igpu"
  | "auto_dgpu"
  | "h264_qsv"
  | "h264_nvenc"
  | "h264_amf"
  | "h264_mf"
  | "libx264";

export type VideoEncoderChoice = {
  codec: string;
  args: string[];
  label: string;
};

const BY_CODEC: Record<string, VideoEncoderChoice> = {
  h264_nvenc: {
    codec: "h264_nvenc",
    label: "NVIDIA NVENC (discrete)",
    args: [
      "-c:v",
      "h264_nvenc",
      "-preset",
      "p4",
      "-rc",
      "vbr",
      "-cq",
      "23",
      "-b:v",
      "0",
      "-pix_fmt",
      "yuv420p",
    ],
  },
  h264_amf: {
    codec: "h264_amf",
    label: "AMD AMF (discrete)",
    args: [
      "-c:v",
      "h264_amf",
      "-quality",
      "balanced",
      "-pix_fmt",
      "yuv420p",
    ],
  },
  h264_qsv: {
    codec: "h264_qsv",
    label: "Intel Quick Sync (iGPU)",
    args: [
      "-c:v",
      "h264_qsv",
      "-preset",
      "medium",
      "-pix_fmt",
      "yuv420p",
    ],
  },
  h264_mf: {
    codec: "h264_mf",
    label: "Windows MediaFoundation",
    args: ["-c:v", "h264_mf", "-pix_fmt", "yuv420p"],
  },
  libx264: {
    codec: "libx264",
    label: "CPU libx264",
    args: ["-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p"],
  },
};

const cache = new Map<string, VideoEncoderChoice>();

function probeEncoder(ffmpegPath: string, codec: string): boolean {
  const result = spawnSync(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=256x256:d=0.1",
      "-frames:v",
      "1",
      "-c:v",
      codec,
      "-pix_fmt",
      "yuv420p",
      "-f",
      "null",
      "-",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20_000,
    },
  );
  return result.status === 0;
}

function orderedCodecs(
  preference: VideoEncoderPreference,
): VideoEncoderChoice[] {
  switch (preference) {
    case "auto_igpu":
      return [
        BY_CODEC.h264_qsv!,
        BY_CODEC.h264_mf!,
        BY_CODEC.h264_amf!,
        BY_CODEC.h264_nvenc!,
        BY_CODEC.libx264!,
      ];
    case "auto_dgpu":
      return [
        BY_CODEC.h264_nvenc!,
        BY_CODEC.h264_amf!,
        BY_CODEC.h264_qsv!,
        BY_CODEC.h264_mf!,
        BY_CODEC.libx264!,
      ];
    case "h264_qsv":
    case "h264_nvenc":
    case "h264_amf":
    case "h264_mf":
    case "libx264":
      return [BY_CODEC[preference]!, BY_CODEC.libx264!].filter(
        (value, index, all) =>
          all.findIndex((item) => item.codec === value.codec) === index,
      );
    default:
      return orderedCodecs("auto_igpu");
  }
}

/**
 * Resolve H.264 encoder from preference. Default auto_igpu prefers Intel QSV / MF
 * before discrete NVENC/AMF. Results are cached per preference.
 */
export function resolveVideoEncoder(
  ffmpegPath = "ffmpeg",
  preference: VideoEncoderPreference = "auto_igpu",
): VideoEncoderChoice {
  const cacheKey = `${ffmpegPath}::${preference}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  for (const candidate of orderedCodecs(preference)) {
    if (probeEncoder(ffmpegPath, candidate.codec)) {
      cache.set(cacheKey, candidate);
      return candidate;
    }
  }

  const fallback = BY_CODEC.libx264!;
  cache.set(cacheKey, fallback);
  return fallback;
}

export function resetVideoEncoderCache(): void {
  cache.clear();
}
