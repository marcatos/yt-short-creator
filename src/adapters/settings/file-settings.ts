import fs from "node:fs/promises";
import path from "node:path";

import type {
  AppSettings,
  BrandVoiceProfile,
  SettingsRepository,
  VideoEncoderPreference,
} from "@/src/ports/settings-repository";
import { BRAND_VOICE_PROFILES } from "@/src/ports/settings-repository";

const VALID_ENCODERS = new Set<VideoEncoderPreference>([
  "auto_igpu",
  "auto_dgpu",
  "h264_qsv",
  "h264_nvenc",
  "h264_amf",
  "h264_mf",
  "libx264",
]);

const VALID_VOICE_PROFILES = new Set<BrandVoiceProfile>(
  BRAND_VOICE_PROFILES,
);

function normalizeSettings(
  defaults: AppSettings,
  stored: Partial<AppSettings>,
): AppSettings {
  const preference = stored.videoEncoderPreference;
  return {
    brandRoot: stored.brandRoot?.trim() || defaults.brandRoot,
    logLevel: stored.logLevel ?? defaults.logLevel,
    defaultPrivacy: stored.defaultPrivacy ?? defaults.defaultPrivacy,
    videoEncoderPreference:
      preference && VALID_ENCODERS.has(preference)
        ? preference
        : defaults.videoEncoderPreference,
    brandVoiceProfile:
      stored.brandVoiceProfile &&
      VALID_VOICE_PROFILES.has(stored.brandVoiceProfile)
        ? stored.brandVoiceProfile
        : defaults.brandVoiceProfile,
    italianVoiceProfile:
      stored.italianVoiceProfile &&
      VALID_VOICE_PROFILES.has(stored.italianVoiceProfile)
        ? stored.italianVoiceProfile
        : defaults.italianVoiceProfile,
    shortsBurnInCaptions:
      stored.shortsBurnInCaptions ?? defaults.shortsBurnInCaptions,
    fullBurnInCaptions:
      stored.fullBurnInCaptions ?? defaults.fullBurnInCaptions,
    voiceDuckDb:
      typeof stored.voiceDuckDb === "number" &&
      Number.isFinite(stored.voiceDuckDb)
        ? stored.voiceDuckDb
        : defaults.voiceDuckDb,
    enableVoiceOverPipeline:
      stored.enableVoiceOverPipeline ?? defaults.enableVoiceOverPipeline,
  };
}

export function createFileSettingsRepository(options: {
  settingsPath: string;
  defaults: AppSettings;
}): SettingsRepository {
  let cached: AppSettings | null = null;

  async function get(): Promise<AppSettings> {
    if (cached) return cached;
    try {
      const stored = JSON.parse(
        await fs.readFile(options.settingsPath, "utf8"),
      ) as Partial<AppSettings>;
      cached = normalizeSettings(options.defaults, stored);
    } catch (error) {
      const isMissing =
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT";
      if (!isMissing) throw error;
      cached = options.defaults;
    }
    return cached;
  }

  async function save(settings: AppSettings): Promise<void> {
    await fs.mkdir(path.dirname(options.settingsPath), { recursive: true });
    const temporaryPath = `${options.settingsPath}.tmp`;
    const normalized = normalizeSettings(options.defaults, settings);
    await fs.writeFile(
      temporaryPath,
      JSON.stringify(normalized, null, 2),
      "utf8",
    );
    await fs.rename(temporaryPath, options.settingsPath);
    cached = normalized;
  }

  return { get, save };
}
