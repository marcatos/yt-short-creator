import fs from "node:fs";
import path from "node:path";

const DEFAULT_STUDIO_PROFILE_RELATIVE = path.join(
  "data",
  "youtube-studio-profile",
);

export function resolveStudioProfileDir(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.YOUTUBE_STUDIO_PROFILE_DIR?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }
  return path.resolve(process.cwd(), DEFAULT_STUDIO_PROFILE_RELATIVE);
}

export function isStudioHeaded(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env.YOUTUBE_STUDIO_HEADED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/** True when Chromium has created a persistent Default profile directory. */
export function studioProfileExists(profileDir: string): boolean {
  try {
    return fs.statSync(path.join(profileDir, "Default")).isDirectory();
  } catch {
    return false;
  }
}
