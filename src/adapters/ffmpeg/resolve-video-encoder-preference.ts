import type { GamingActivityPort } from "@/src/ports/gaming-activity";
import type { Logger } from "@/src/ports/logger";
import type {
  SettingsRepository,
  VideoEncoderPreference,
} from "@/src/ports/settings-repository";

const VALID_ENV_PREFERENCES = new Set<VideoEncoderPreference>([
  "auto",
  "auto_igpu",
  "auto_dgpu",
  "h264_qsv",
  "h264_nvenc",
  "h264_amf",
  "h264_mf",
  "libx264",
]);

export type ResolvedVideoEncoderPreference = {
  configured: VideoEncoderPreference;
  effective: Exclude<VideoEncoderPreference, "auto">;
  gamingActive: boolean | null;
};

export type VideoEncoderPreferenceDeps = {
  settings?: SettingsRepository;
  gamingActivity?: GamingActivityPort;
  videoEncoderPreference?: VideoEncoderPreference;
  logger?: Logger;
  fallback?: VideoEncoderPreference;
};

export function parseVideoEncoderPreferenceFromEnv():
  | VideoEncoderPreference
  | undefined {
  const raw = process.env.FFMPEG_VIDEO_ENCODER?.trim();
  if (!raw) return undefined;
  if (VALID_ENV_PREFERENCES.has(raw as VideoEncoderPreference)) {
    return raw as VideoEncoderPreference;
  }
  return undefined;
}

/**
 * Resolves the encoder preference used for probing FFmpeg.
 * `auto` → iGPU (QSV) while gaming, discrete GPU (NVENC) when idle.
 */
export async function resolveVideoEncoderPreference(
  deps: VideoEncoderPreferenceDeps,
): Promise<ResolvedVideoEncoderPreference> {
  const configured =
    deps.videoEncoderPreference ??
    parseVideoEncoderPreferenceFromEnv() ??
    (deps.settings
      ? (await deps.settings.get()).videoEncoderPreference
      : undefined) ??
    deps.fallback ??
    "auto";

  if (configured !== "auto") {
    return { configured, effective: configured, gamingActive: null };
  }

  const gamingActive = deps.gamingActivity
    ? await deps.gamingActivity.isActive()
    : false;
  const effective: VideoEncoderPreference = gamingActive
    ? "auto_igpu"
    : "auto_dgpu";

  deps.logger?.info("Gaming-aware video encoder preference resolved", {
    configured,
    effective,
    gamingActive,
  });

  return { configured, effective, gamingActive };
}
