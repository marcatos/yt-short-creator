/**
 * One-time headed Google login into the shared YouTube Studio Chrome profile.
 *
 * Google blocks Playwright-launched Chrome ("browser may not be secure").
 * This script starts a normal Chrome process; you sign in manually; only then
 * does Playwright attach via CDP to verify Studio is signed in.
 *
 * Run: npm run studio:login
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { chromium, type Browser, type Page } from "playwright";

import { createLogger } from "../src/adapters/logging/pino-logger";
import { withStudioLock } from "../src/adapters/youtube/studio-mutex";
import {
  resolveChromeExecutablePath,
  resolveStudioCdpPort,
  resolveStudioProfileDir,
} from "../src/adapters/youtube/studio-profile";
import type { LogLevel } from "../src/ports/logger";

const STUDIO_URL = "https://studio.youtube.com";
const VERIFY_TIMEOUT_MS = 30_000;
const CDP_READY_TIMEOUT_MS = 60_000;

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

function isSignedInStudioUrl(href: string): boolean {
  if (!href.includes("studio.youtube.com")) return false;
  if (href.includes("accounts.google.com")) return false;
  return /studio\.youtube\.com\/channel\//i.test(href);
}

async function assertSignedInStudio(page: Page): Promise<void> {
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
    { timeout: VERIFY_TIMEOUT_MS },
  );
}

async function waitForCdp(port: number, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const endpoint = `http://127.0.0.1:${port}`;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) {
        return endpoint;
      }
      lastError = new Error(`CDP /json/version status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Chrome CDP did not become ready on port ${port}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function stopChrome(child: ChildProcessWithoutNullStreams): void {
  if (child.killed || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    // best-effort
  }
}

async function waitForOperatorEnter(message: string): Promise<void> {
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question(message);
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const log = createLogger(parseLogLevel(process.env.LOG_LEVEL)).child({
    component: "StudioLogin",
  });
  const startedAt = performance.now();
  log.info("Studio login starting (native Chrome; Playwright attaches only after login)");

  const profileDir = resolveStudioProfileDir(process.env);
  const chromePath = resolveChromeExecutablePath(process.env);
  const cdpPort = resolveStudioCdpPort(process.env);
  const customProfile = Boolean(
    process.env.YOUTUBE_STUDIO_PROFILE_DIR?.trim(),
  );

  if (!chromePath) {
    throw new Error(
      "Google Chrome executable not found. Install Chrome or set YOUTUBE_STUDIO_CHROME_PATH.",
    );
  }

  fs.mkdirSync(profileDir, { recursive: true });

  await withStudioLock(async () => {
    log.info("Spawning Google Chrome (not Playwright-controlled)", {
      customProfile,
      cdpPort,
      chromeFound: true,
    });

    const launchStartedAt = performance.now();
    const child = spawn(
      chromePath,
      [
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=TranslateUI",
        STUDIO_URL,
      ],
      {
        stdio: "ignore",
        detached: false,
        windowsHide: false,
      },
    );

    let browser: Browser | null = null;
    try {
      await waitForCdp(cdpPort, CDP_READY_TIMEOUT_MS);
      log.info("Chrome CDP ready — sign in in the Chrome window only", {
        cdpPort,
        durationMs: Math.round(performance.now() - launchStartedAt),
      });

      await waitForOperatorEnter(
        "\nAfter you are signed into YouTube Studio in Chrome, press Enter here to verify… ",
      );

      const verifyStartedAt = performance.now();
      const cdpUrl = `http://127.0.0.1:${cdpPort}`;
      browser = await chromium.connectOverCDP(cdpUrl);
      const context = browser.contexts()[0];
      if (!context) {
        throw new Error("No Chrome browser context available over CDP");
      }
      const page =
        context.pages().find((candidate) =>
          isSignedInStudioUrl(candidate.url()),
        ) ??
        context.pages()[0] ??
        (await context.newPage());

      if (!isSignedInStudioUrl(page.url())) {
        await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded" });
      }
      await assertSignedInStudio(page);
      log.info("Signed-in Studio verified", {
        durationMs: Math.round(performance.now() - verifyStartedAt),
      });
    } finally {
      try {
        await browser?.close();
      } catch {
        // browser may already be closed with Chrome
      }
      stopChrome(child);
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
