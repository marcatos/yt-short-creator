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

/** True when the browser has created a persistent Default profile directory. */
export function studioProfileExists(profileDir: string): boolean {
  try {
    return fs.statSync(path.join(profileDir, "Default")).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Playwright channel for Studio automation. Prefer installed Google Chrome
 * so login cookies match a real Chrome profile (not bundled Chromium).
 * Override with YOUTUBE_STUDIO_BROWSER_CHANNEL (e.g. "chromium", "msedge").
 */
export function resolveStudioBrowserChannel(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.YOUTUBE_STUDIO_BROWSER_CHANNEL?.trim();
  return configured && configured.length > 0 ? configured : "chrome";
}

/** Shared launch options for login + Inspiration scrape persistent contexts. */
export function studioPersistentContextOptions(input: {
  headed: boolean;
  env?: Record<string, string | undefined>;
}): {
  headless: boolean;
  channel: string;
  viewport: { width: number; height: number };
} {
  return {
    headless: !input.headed,
    channel: resolveStudioBrowserChannel(input.env),
    viewport: { width: 1280, height: 800 },
  };
}
