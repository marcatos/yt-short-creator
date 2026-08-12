import type { LogLevel } from "./logger";

export type DefaultPrivacy = "public" | "unlisted" | "private";

export const BRAND_VOICE_PROFILES = [
  "coral",
  "verse",
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;

export type BrandVoiceProfile = (typeof BRAND_VOICE_PROFILES)[number];

export type VideoEncoderPreference =
  | "auto_igpu"
  | "auto_dgpu"
  | "h264_qsv"
  | "h264_nvenc"
  | "h264_amf"
  | "h264_mf"
  | "libx264";

export type AppSettings = {
  brandRoot: string;
  logLevel: LogLevel;
  defaultPrivacy: DefaultPrivacy;
  /** Prefer iGPU by default to leave the discrete GPU free for other apps. */
  videoEncoderPreference: VideoEncoderPreference;
  brandVoiceProfile: BrandVoiceProfile;
  shortsBurnInCaptions: boolean;
  fullBurnInCaptions: boolean;
  voiceDuckDb: number;
  enableVoiceOverPipeline: boolean;
};

export interface SettingsRepository {
  get(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<void>;
}
