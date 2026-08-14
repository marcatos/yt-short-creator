/**
 * One-time headed Google login into the shared YouTube Studio Chrome profile.
 *
 * Run: npm run studio:login
 * Then complete sign-in in the browser. Exits 0 when Studio looks signed in.
 * Uses installed Google Chrome (channel: chrome), not bundled Chromium.
 */
import fs from "node:fs";
import path from "node:path";

import { chromium, type Page } from "playwright";

import { createLogger } from "../src/adapters/logging/pino-logger";
import { withStudioLock } from "../src/adapters/youtube/studio-mutex";
import {
  resolveStudioBrowserChannel,
  resolveStudioProfileDir,
  studioPersistentContextOptions,
} from "../src/adapters/youtube/studio-profile";
import type { LogLevel } from "../src/ports/logger";

const STUDIO_URL = "https://studio.youtube.com";
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const WAIT_PROGRESS_MS = 30_000;

function loadEnvLocal(): void {
  const envPath = path.resolve(".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env) || !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim().toUpperCase();
  if (
    normalized === "DEBUG" ||
    normalized === "INFO" ||
    normalized === "WARN" ||
    normalized === "ERROR"
  ) {
    return normalized;
  }
  return "INFO";
}

async function waitUntilSignedInStudio(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const href = location.href;
      if (!href.includes("studio.youtube.com")) return false;
      if (href.includes("accounts.google.com")) return false;
      const studioRoot = document.querySelector(
        "ytcp-app, ytcp-navigation, ytcp-entity-page",
      );
      if (studioRoot) return true;
      return /studio\.youtube\.com\/channel\//i.test(href);
    },
    { timeout: LOGIN_TIMEOUT_MS },
  );
}

async function main(): Promise<void> {
  loadEnvLocal();
  const log = createLogger(parseLogLevel(process.env.LOG_LEVEL)).child({
    component: "StudioLogin",
  });
  const startedAt = performance.now();
  log.info("Studio login starting");

  const profileDir = resolveStudioProfileDir(process.env);
  const customProfile = Boolean(
    process.env.YOUTUBE_STUDIO_PROFILE_DIR?.trim(),
  );

  await withStudioLock(async () => {
    const channel = resolveStudioBrowserChannel(process.env);
    log.info("Launching headed Chrome persistent context", {
      customProfile,
      channel,
    });
    const launchStartedAt = performance.now();
    const context = await chromium.launchPersistentContext(
      profileDir,
      studioPersistentContextOptions({ headed: true }),
    );
    log.info("Chrome launched", {
      channel,
      durationMs: Math.round(performance.now() - launchStartedAt),
    });

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      log.info("Opening YouTube Studio; complete Google login in the browser");
      await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded" });

      const waitStartedAt = performance.now();
      const progress = setInterval(() => {
        log.info("Waiting for signed-in YouTube Studio", {
          elapsedMs: Math.round(performance.now() - waitStartedAt),
        });
      }, WAIT_PROGRESS_MS);
      try {
        await waitUntilSignedInStudio(page);
      } finally {
        clearInterval(progress);
      }
      log.info("Signed-in Studio detected", {
        durationMs: Math.round(performance.now() - waitStartedAt),
      });
    } finally {
      await context.close();
    }
  });

  log.info("Studio login finished", {
    durationMs: Math.round(performance.now() - startedAt),
  });
}

main().catch((error: unknown) => {
  const log = createLogger(parseLogLevel(process.env.LOG_LEVEL)).child({
    component: "StudioLogin",
  });
  log.error("Studio login failed", {
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : String(error),
  });
  process.exit(1);
});
