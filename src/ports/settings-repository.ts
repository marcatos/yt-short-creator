import type { LogLevel } from "./logger";

export type DefaultPrivacy = "public" | "unlisted" | "private";

export const BRAND_VOICE_PROFILES = [
  "coral",
  "ash",
  "nova",
  "marin",
  "sage",
  "verse",
  "alloy",
  "echo",
  "fable",
  "onyx",
  "shimmer",
  "ballad",
  "cedar",
] as const;

export type BrandVoiceProfile = (typeof BRAND_VOICE_PROFILES)[number];

export type VideoEncoderPreference =
  | "auto"
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
  /**
   * `auto` uses iGPU while gaming and NVENC when idle. Force options pin a
   * specific encoder family regardless of gaming state.
   */
  videoEncoderPreference: VideoEncoderPreference;
  /** English VO voice (kept as coral by default — preferred EN delivery). */
  brandVoiceProfile: BrandVoiceProfile;
  /**
   * Italian VO voice. Defaults to ash: clearer/younger than coral on Italian,
   * which otherwise reads slow/mature.
   */
  italianVoiceProfile: BrandVoiceProfile;
  /** Driver narrative vs third-person sports commentary for full-race VO. */
  voiceOverMode: "driver" | "commentator";
  /** EN commentary voice (broadcast-friendly; default verse). */
  commentaryVoiceProfileEn: BrandVoiceProfile;
  /** IT commentary voice (broadcast F1 energy; default marin). */
  commentaryVoiceProfileIt: BrandVoiceProfile;
  /** Duck commentary stem during Short VO (e.g. -30 dB). */
  commentaryDuckDb: number;
  shortsBurnInCaptions: boolean;
  fullBurnInCaptions: boolean;
  voiceDuckDb: number;
  enableVoiceOverPipeline: boolean;
  instagramShareToFeed: boolean;
  instagramDefaultHashtags: string[];
  youtubeChannelUrlOverride?: string;
};

export interface SettingsRepository {
  get(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<void>;
}
