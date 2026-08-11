import { spawnSync } from "node:child_process";

export type VideoEncoderChoice = {
  codec: string;
  args: string[];
  label: string;
};

const ENCODER_CANDIDATES: VideoEncoderChoice[] = [
  {
    codec: "h264_nvenc",
    label: "NVIDIA NVENC",
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
  {
    codec: "h264_amf",
    label: "AMD AMF",
    args: [
      "-c:v",
      "h264_amf",
      "-quality",
      "balanced",
      "-pix_fmt",
      "yuv420p",
    ],
  },
  {
    codec: "h264_qsv",
    label: "Intel Quick Sync",
    args: [
      "-c:v",
      "h264_qsv",
      "-preset",
      "medium",
      "-pix_fmt",
      "yuv420p",
    ],
  },
  {
    codec: "h264_mf",
    label: "Windows MediaFoundation",
    args: ["-c:v", "h264_mf", "-pix_fmt", "yuv420p"],
  },
  {
    codec: "libx264",
    label: "CPU libx264",
    args: ["-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p"],
  },
];

let cachedChoice: VideoEncoderChoice | null = null;

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
      // NVENC rejects tiny frames; 256x256 is safely above minima.
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

/**
 * Prefer GPU H.264 encoders when a probe encode succeeds; fall back to libx264.
 * Result is cached for the process lifetime.
 */
export function resolveVideoEncoder(
  ffmpegPath = "ffmpeg",
  preferredCodec?: string,
): VideoEncoderChoice {
  if (cachedChoice && !preferredCodec) {
    return cachedChoice;
  }

  if (preferredCodec) {
    const preferred = ENCODER_CANDIDATES.find((c) => c.codec === preferredCodec);
    if (preferred && probeEncoder(ffmpegPath, preferred.codec)) {
      cachedChoice = preferred;
      return preferred;
    }
  }

  for (const candidate of ENCODER_CANDIDATES) {
    if (probeEncoder(ffmpegPath, candidate.codec)) {
      cachedChoice = candidate;
      return candidate;
    }
  }

  const fallback = ENCODER_CANDIDATES[ENCODER_CANDIDATES.length - 1]!;
  cachedChoice = fallback;
  return fallback;
}

/** Test helper to clear encoder cache between cases. */
export function resetVideoEncoderCache(): void {
  cachedChoice = null;
}
