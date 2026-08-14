import fs from "node:fs";
import path from "node:path";

const DEFAULT_STUDIO_PROFILE_RELATIVE = path.join(
  "data",
  "youtube-studio-profile",
);

const DEFAULT_CDP_PORT = 9222;

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
  // Google often rejects headless Studio sessions even with a valid profile.
  // Default headed; set YOUTUBE_STUDIO_HEADED=0 to force headless.
  const value = env.YOUTUBE_STUDIO_HEADED?.trim().toLowerCase();
  if (value === "0" || value === "false" || value === "no") return false;
  if (value === "1" || value === "true" || value === "yes") return true;
  return true;
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
 * Playwright channel for Studio automation after login.
 * Override with YOUTUBE_STUDIO_BROWSER_CHANNEL (e.g. "msedge", "chromium").
 */
export function resolveStudioBrowserChannel(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.YOUTUBE_STUDIO_BROWSER_CHANNEL?.trim();
  return configured && configured.length > 0 ? configured : "chrome";
}

export function resolveStudioCdpPort(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.YOUTUBE_STUDIO_CDP_PORT?.trim();
  if (!raw) return DEFAULT_CDP_PORT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65_535) {
    return DEFAULT_CDP_PORT;
  }
  return parsed;
}

/**
 * Resolve installed Google Chrome executable (Windows-first).
 * Override with YOUTUBE_STUDIO_CHROME_PATH.
 */
export function resolveChromeExecutablePath(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const configured = env.YOUTUBE_STUDIO_CHROME_PATH?.trim();
  if (configured) {
    return configured;
  }

  const candidates: string[] = [];
  if (process.platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? process.env.LOCALAPPDATA ?? "";
    const programFiles = env.PROGRAMFILES ?? process.env.PROGRAMFILES ?? "";
    const programFilesX86 =
      env["PROGRAMFILES(X86)"] ?? process.env["ProgramFiles(x86)"] ?? "";
    candidates.push(
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(
        programFilesX86,
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
      path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    );
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

/** Shared launch options for Inspiration scrape persistent contexts. */
export function studioPersistentContextOptions(input: {
  headed: boolean;
  env?: Record<string, string | undefined>;
}): {
  headless: boolean;
  channel: string;
  viewport: { width: number; height: number };
  ignoreDefaultArgs: string[];
  args: string[];
} {
  return {
    headless: !input.headed,
    channel: resolveStudioBrowserChannel(input.env),
    viewport: { width: 1280, height: 800 },
    // Reduce automation fingerprints for post-login Studio pages.
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled"],
  };
}
