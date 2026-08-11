import fs from "node:fs/promises";
import path from "node:path";

import type {
  AppSettings,
  SettingsRepository,
} from "@/src/ports/settings-repository";

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
      ) as AppSettings;
      cached = stored;
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
    await fs.writeFile(temporaryPath, JSON.stringify(settings, null, 2), "utf8");
    await fs.rename(temporaryPath, options.settingsPath);
    cached = settings;
  }

  return { get, save };
}
