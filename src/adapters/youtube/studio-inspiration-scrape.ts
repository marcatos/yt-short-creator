import type { Logger } from "@/src/ports/logger";
import {
  StudioInspirationUiError,
  StudioSessionUnavailableError,
  type CapturedInspirationIdea,
  type InspirationCaptureResult,
} from "@/src/ports/youtube-studio-inspiration";

import { parseIdeaFromTexts } from "./studio-inspiration-parse";

/**
 * Fragile YouTube Studio Inspiration DOM hooks.
 * Update here when Studio chrome drifts — not in scrape control flow.
 *
 * Documented from YouTube Help (Studio → Content → Inspiration tab) plus
 * public Studio custom-element naming. Not verified against a live signed-in
 * Studio session in CI; operators should re-tune after `npm run studio:login`.
 *
 * EN/IT labels: Inspiration/Ispirazione, Content/Contenuti.
 */
export const INSPIRATION_SELECTORS = {
  studioHome: "https://studio.youtube.com",
  studioApp: "ytcp-app, ytcp-navigation, ytcp-entity-page",
  /** Content uploads page (sibling tabs live under /content/…). */
  contentPath: (channelId: string) =>
    `https://studio.youtube.com/channel/${channelId}/content/videos`,
  /** Canonical Inspiration feed (Studio: Content → Inspiration tab). */
  inspirationPath: (channelId: string) =>
    `https://studio.youtube.com/channel/${channelId}/content/inspiration`,
  /**
   * Legacy/alternate paths. Do not prefer `/videos/inspiration` — Studio serves
   * the real feed under `/content/inspiration` (with Videos/Shorts/… sibling tabs).
   */
  inspirationPaths: (channelId: string) => [
    `https://studio.youtube.com/channel/${channelId}/content/inspiration`,
  ],
  contentNavNames: /^(content|contenuti)$/i,
  contentNavCandidates: [
    "ytcp-navigation-drawer a[href*='/content']",
    "ytcp-navigation-drawer a[href*='/videos']",
    "#menu-item-content",
    "a[href*='/content/videos']",
    "a[href*='/videos/upload']",
  ],
  inspirationTabNames: /inspiration|ispirazione/i,
  inspirationTabCandidates: [
    "tp-yt-paper-tab",
    "ytcp-tab",
    "[role='tab']",
    "ytcp-animatable tp-yt-paper-tab",
    "#tabsContent tp-yt-paper-tab",
    "a[href*='/content/inspiration']",
    "text=/Inspiration|Ispirazione/i",
  ],
  ideaCardCandidates: [
    "ytci-feed-idea-preview",
    "ytci-feed-idea-card",
    "[data-idea-id]",
    "ytcd-video-idea-card",
    "ytcd-inspiration-idea-card",
    "ytcd-inspiration-card",
    "[class*='idea-card']",
    "article:has-text('Audience interest')",
    "article:has-text('Interesse del pubblico')",
    ":text('Audience interest')",
    ":text('Interesse del pubblico')",
  ],
  detailPanel:
    "ytci-pitch-dialog, ytci-feed-idea-preview[expanded], ytci-idea-detail, ytcd-idea-detail, ytcp-dialog[opened], [role='dialog'], ytcd-inspiration-detail",
  closeDetail:
    "ytci-pitch-dialog button[aria-label='Close'], ytci-pitch-dialog button[aria-label='Chiudi'], ytci-pitch-dialog #close-button, ytci-pitch-dialog ytcp-icon-button[aria-label='Close'], ytci-pitch-dialog ytcp-icon-button[aria-label='Chiudi'], button[aria-label='Close'], button[aria-label='Chiudi'], #close-button, ytcp-icon-button[aria-label='Close']",
  pitchDialog: "ytci-pitch-dialog",
  /** Loading copy while Studio generates idea cards. */
  loadingCopy: /cercando idee|ci stiamo lavorando|looking for ideas|working on it/i,
} as const;

export const INSPIRATION_NAV_TIMEOUT_MS = 30_000;
export const INSPIRATION_CARD_TIMEOUT_MS = 8_000;
/** Default cap for scroll-loaded Inspiration cards per sync. */
export const DEFAULT_INSPIRATION_SCRAPE_MAX = 80;
export const INSPIRATION_FEED_EXPAND_IDLE_MS = 1_200;
export const INSPIRATION_FEED_EXPAND_MAX_ROUNDS = 40;
export const INSPIRATION_FEED_EXPAND_STABLE_ROUNDS = 3;

export type LocatorLike = {
  first(): LocatorLike;
  nth(index: number): LocatorLike;
  count(): Promise<number>;
  click(options?: { timeout?: number; force?: boolean }): Promise<void>;
  innerText(): Promise<string>;
  getAttribute(name: string): Promise<string | null>;
  isVisible(): Promise<boolean>;
  waitFor(options?: { state?: string; timeout?: number }): Promise<void>;
  scrollIntoViewIfNeeded?(): Promise<void>;
};

export type PageLike = {
  goto(
    url: string,
    options?: { waitUntil?: "domcontentloaded" | "load"; timeout?: number },
  ): Promise<unknown>;
  url(): string;
  locator(selector: string): LocatorLike;
  getByRole(role: string, options?: { name?: string | RegExp }): LocatorLike;
  keyboard: { press(key: string): Promise<void> };
  evaluate?<T>(fn: () => T): Promise<T>;
  mouse?: { wheel(deltaX: number, deltaY: number): Promise<void> };
};

export type CapturedInspirationCard = {
  idea: CapturedInspirationIdea;
  expanded: boolean;
};

export type InspirationPageHelpers = {
  gotoAndEnsureSignedIn(): Promise<void>;
  openInspirationFeed(): Promise<void>;
  /** Scroll-load more feed cards up to maxCards; returns visible count. */
  expandFeed(maxCards: number): Promise<number>;
  countCards(): Promise<number>;
  captureCard(index: number): Promise<CapturedInspirationCard>;
  currentUrl(): string;
};

export type ScrapeInspirationOptions = {
  maxCards?: number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorMeta(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { error: String(error) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrollInspirationFeed(page: PageLike): Promise<void> {
  if (typeof page.evaluate === "function") {
    await page.evaluate(() => {
      const candidates = [
        document.querySelector("#contents"),
        document.querySelector("ytci-feed"),
        document.querySelector("#main"),
        document.scrollingElement,
      ].filter(Boolean) as Element[];
      for (const el of candidates) {
        const height =
          "clientHeight" in el
            ? Number((el as HTMLElement).clientHeight) || 800
            : 800;
        el.scrollBy(0, Math.max(700, height));
      }
      window.scrollBy(0, 900);
    });
    return;
  }
  if (page.mouse?.wheel) {
    await page.mouse.wheel(0, 1400);
  }
}

export function extractStudioChannelId(url: string): string | null {
  const match = url.match(/\/channel\/(UC[\w-]+)/);
  return match?.[1] ?? null;
}

async function firstNonEmptyLocator(
  page: PageLike,
  selectors: readonly string[],
): Promise<LocatorLike | null> {
  for (const selector of selectors) {
    const loc = page.locator(selector);
    if ((await loc.count()) > 0) return loc;
  }
  return null;
}

async function clickFirstRole(
  page: PageLike,
  roles: string[],
  name: RegExp,
): Promise<boolean> {
  for (const role of roles) {
    const loc = page.getByRole(role, { name });
    if ((await loc.count()) > 0) {
      await loc.first().click({ timeout: INSPIRATION_NAV_TIMEOUT_MS });
      return true;
    }
  }
  return false;
}

async function clickMatchingLocator(
  page: PageLike,
  selectors: readonly string[],
  name: RegExp,
): Promise<boolean> {
  for (const selector of selectors) {
    const loc = page.locator(selector);
    const count = await loc.count();
    for (let index = 0; index < count; index += 1) {
      const item = loc.nth(index);
      const text = (await item.innerText()).trim();
      if (!name.test(text)) continue;
      await item.click({ timeout: INSPIRATION_NAV_TIMEOUT_MS });
      return true;
    }
  }
  return false;
}

/** Wait for Content section tabs, then activate Inspiration / Ispirazione. */
async function activateInspirationTab(page: PageLike): Promise<boolean> {
  try {
    await page
      .locator("tp-yt-paper-tab, [role='tab']")
      .first()
      .waitFor({ state: "visible", timeout: INSPIRATION_NAV_TIMEOUT_MS });
  } catch {
    // Fall through — click helpers may still find a late tab.
  }

  if (
    (await clickFirstRole(
      page,
      ["tab"],
      INSPIRATION_SELECTORS.inspirationTabNames,
    )) ||
    (await clickMatchingLocator(
      page,
      INSPIRATION_SELECTORS.inspirationTabCandidates,
      INSPIRATION_SELECTORS.inspirationTabNames,
    ))
  ) {
    // Give the SPA a moment to swap the feed.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    return true;
  }
  return false;
}

async function dismissDetail(page: PageLike): Promise<void> {
  const pitch = page.locator(INSPIRATION_SELECTORS.pitchDialog);
  try {
    if ((await pitch.count()) > 0 && (await pitch.first().isVisible())) {
      const closeInPitch = page.locator(INSPIRATION_SELECTORS.closeDetail).first();
      try {
        if (await closeInPitch.isVisible()) {
          await closeInPitch.click({ timeout: 2_000 });
          await new Promise((resolve) => setTimeout(resolve, 500));
          if ((await pitch.count()) === 0) return;
        }
      } catch {
        // Fall through to Escape.
      }
      await page.keyboard.press("Escape");
      await new Promise((resolve) => setTimeout(resolve, 500));
      if ((await pitch.count()) > 0) {
        await page.keyboard.press("Escape");
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return;
    }
  } catch {
    // Fall through to generic close.
  }

  const close = page.locator(INSPIRATION_SELECTORS.closeDetail).first();
  try {
    if (await close.isVisible()) {
      await close.click({ timeout: 2_000 });
      return;
    }
  } catch {
    // Fall through to Escape.
  }
  await page.keyboard.press("Escape");
}



export function createPlaywrightInspirationHelpers(
  page: PageLike,
): InspirationPageHelpers {
  async function resolveCardList(): Promise<LocatorLike | null> {
    // Prefer the live Studio custom element discovered via probe.
    const primary = page.locator("ytci-feed-idea-preview");
    if ((await primary.count()) > 0) return primary;
    return firstNonEmptyLocator(page, INSPIRATION_SELECTORS.ideaCardCandidates);
  }

  async function waitForIdeaCards(timeoutMs: number): Promise<number> {
    const primary = page.locator("ytci-feed-idea-preview");
    const deadline = Date.now() + timeoutMs;
    let sawPrimary = false;

    try {
      await primary.first().waitFor({
        state: "attached",
        timeout: Math.min(timeoutMs, 45_000),
      });
      sawPrimary = true;
    } catch {
      // Primary custom element missing — try legacy/test selectors once.
      const fallback = await firstNonEmptyLocator(
        page,
        INSPIRATION_SELECTORS.ideaCardCandidates,
      );
      return fallback ? fallback.count() : 0;
    }

    // Cards often mount as empty loading shells; wait for titles to hydrate.
    while (Date.now() < deadline) {
      const count = await primary.count();
      if (count === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        continue;
      }
      let ready = 0;
      for (let index = 0; index < count; index += 1) {
        const text = (await primary.nth(index).innerText()).trim();
        if (text.length > 0) ready += 1;
      }
      const loading = await page
        .locator(".ytciFeedIdeaPreviewLoadingPlaceholder")
        .count();
      if (ready > 0) return count;
      if (loading === 0 && count > 0) {
        // Shells present without the loading class — give text one more beat.
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const recheck = await primary.count();
        let readyAfter = 0;
        for (let index = 0; index < recheck; index += 1) {
          const text = (await primary.nth(index).innerText()).trim();
          if (text.length > 0) readyAfter += 1;
        }
        if (readyAfter > 0) return recheck;
        return recheck;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }

    return sawPrimary ? primary.count() : 0;
  }

  return {
    currentUrl: () => page.url(),

    async gotoAndEnsureSignedIn(): Promise<void> {
      await page.goto(INSPIRATION_SELECTORS.studioHome, {
        waitUntil: "domcontentloaded",
        timeout: INSPIRATION_NAV_TIMEOUT_MS,
      });
      const href = page.url();
      if (href.includes("accounts.google.com")) {
        throw new StudioSessionUnavailableError(
          "YouTube Studio session is logged out; run npm run studio:login",
        );
      }
      try {
        await page
          .locator(INSPIRATION_SELECTORS.studioApp)
          .first()
          .waitFor({
            state: "visible",
            timeout: INSPIRATION_NAV_TIMEOUT_MS,
          });
      } catch {
        if (!/studio\.youtube\.com\/channel\//i.test(page.url())) {
          throw new StudioInspirationUiError(
            `Signed-in YouTube Studio chrome was not detected (url=${page.url()})`,
          );
        }
      }
    },

    async openInspirationFeed(): Promise<void> {
      let channelId = extractStudioChannelId(page.url());
      if (!channelId) {
        // Studio home usually redirects to /channel/UC…/; re-read after a hop.
        await page.goto(INSPIRATION_SELECTORS.studioHome, {
          waitUntil: "domcontentloaded",
          timeout: INSPIRATION_NAV_TIMEOUT_MS,
        });
        channelId = extractStudioChannelId(page.url());
      }

      if (channelId) {
        const inspirationUrl =
          INSPIRATION_SELECTORS.inspirationPath(channelId);
        let onInspiration = false;

        for (let attempt = 0; attempt < 3 && !onInspiration; attempt += 1) {
          await page.goto(inspirationUrl, {
            waitUntil: "domcontentloaded",
            timeout: INSPIRATION_NAV_TIMEOUT_MS,
          });
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          if (/\/content\/inspiration\b/i.test(page.url())) {
            onInspiration = true;
            break;
          }
          // Studio sometimes keeps the last Content tab (Videos) despite the
          // /inspiration URL. Click the Inspiration tab on the Content page.
          if (/\/content\//i.test(page.url())) {
            onInspiration = await activateInspirationTab(page);
            if (onInspiration && /\/inspiration\b/i.test(page.url())) break;
            onInspiration = /\/inspiration\b/i.test(page.url());
          }
        }

        if (!onInspiration) {
          await page.goto(INSPIRATION_SELECTORS.contentPath(channelId), {
            waitUntil: "domcontentloaded",
            timeout: INSPIRATION_NAV_TIMEOUT_MS,
          });
          onInspiration = await activateInspirationTab(page);
        }

        if (!onInspiration && !/\/inspiration\b/i.test(page.url())) {
          throw new StudioInspirationUiError(
            `YouTube Studio Inspiration tab was not found (url=${page.url()})`,
          );
        }
      } else {
        const clickedNav = await clickFirstRole(
          page,
          ["link", "menuitem"],
          INSPIRATION_SELECTORS.contentNavNames,
        );
        if (!clickedNav) {
          const nav = await firstNonEmptyLocator(
            page,
            INSPIRATION_SELECTORS.contentNavCandidates,
          );
          if (!nav) {
            throw new StudioInspirationUiError(
              "YouTube Studio Content navigation was not found",
            );
          }
          await nav.first().click({ timeout: INSPIRATION_NAV_TIMEOUT_MS });
        }
        const clickedTab = await activateInspirationTab(page);
        if (!clickedTab) {
          throw new StudioInspirationUiError(
            `YouTube Studio Inspiration tab was not found (url=${page.url()})`,
          );
        }
      }

      const cardCount = await waitForIdeaCards(120_000);
      if (cardCount === 0) {
        throw new StudioInspirationUiError(
          `No Inspiration idea cards found (url=${page.url()})`,
        );
      }
    },

    async countCards(): Promise<number> {
      const list = await resolveCardList();
      return list ? list.count() : 0;
    },

    async expandFeed(maxCards: number): Promise<number> {
      const cap = Math.max(1, maxCards);
      let previous = 0;
      let stableRounds = 0;

      for (
        let round = 0;
        round < INSPIRATION_FEED_EXPAND_MAX_ROUNDS;
        round += 1
      ) {
        const list = await resolveCardList();
        const count = list ? await list.count() : 0;
        if (count >= cap) {
          return cap;
        }
        if (list && count > 0) {
          try {
            const last = list.nth(count - 1);
            if (last.scrollIntoViewIfNeeded) {
              await last.scrollIntoViewIfNeeded();
            }
          } catch {
            // Keep scrolling even if the last card cannot be focused.
          }
        }
        await scrollInspirationFeed(page);
        await sleep(INSPIRATION_FEED_EXPAND_IDLE_MS);

        const nextList = await resolveCardList();
        const next = nextList ? await nextList.count() : 0;
        if (next >= cap) {
          return cap;
        }
        if (next <= previous) {
          stableRounds += 1;
          if (stableRounds >= INSPIRATION_FEED_EXPAND_STABLE_ROUNDS) {
            return next;
          }
        } else {
          stableRounds = 0;
        }
        previous = next;
      }

      const finalList = await resolveCardList();
      const finalCount = finalList ? await finalList.count() : 0;
      return Math.min(finalCount, cap);
    },

    async captureCard(index: number): Promise<CapturedInspirationCard> {
      // A leftover pitch dialog blocks clicks on the next feed card.
      await dismissDetail(page);

      const list = await resolveCardList();
      if (!list) {
        throw new Error("Inspiration idea cards disappeared");
      }
      const card = list.nth(index);
      if (card.scrollIntoViewIfNeeded) {
        try {
          await card.scrollIntoViewIfNeeded();
        } catch {
          // Capture may still succeed without scroll.
        }
      }
      const studioId =
        (await card.getAttribute("data-idea-id")) ??
        (await card.getAttribute("data-id"));
      let cardText = (await card.innerText()).trim();
      if (!cardText) {
        cardText = (await card.getAttribute("aria-label"))?.trim() ?? "";
      }

      try {
        await card.click({ timeout: INSPIRATION_CARD_TIMEOUT_MS });
      } catch {
        await dismissDetail(page);
        await card.click({
          timeout: INSPIRATION_CARD_TIMEOUT_MS,
          force: true,
        });
      }

      let detailText = "";
      let expanded = false;
      try {
        // Pitch dialog is the live Studio detail surface; fall back to legacy
        // detail selectors used in unit tests / older Studio chrome.
        const pitch = page.locator(INSPIRATION_SELECTORS.pitchDialog).first();
        const legacy = page.locator(INSPIRATION_SELECTORS.detailPanel).first();
        try {
          await pitch.waitFor({
            state: "attached",
            timeout: Math.min(INSPIRATION_CARD_TIMEOUT_MS, 4_000),
          });
          await new Promise((resolve) => setTimeout(resolve, 800));
          detailText = (await pitch.innerText()).trim();
        } catch {
          await legacy.waitFor({
            state: "visible",
            timeout: INSPIRATION_CARD_TIMEOUT_MS,
          });
          detailText = (await legacy.innerText()).trim();
        }
        if (!detailText) {
          detailText = (await legacy.innerText()).trim();
        }
        expanded = Boolean(detailText);
        cardText = (await card.innerText()).trim() || cardText;
      } catch {
        expanded = false;
        cardText = (await card.innerText()).trim() || cardText;
      } finally {
        await dismissDetail(page);
      }

      if (!cardText && detailText.trim()) {
        cardText =
          detailText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find(Boolean) ?? "";
      }

      return {
        idea: parseIdeaFromTexts({ studioId, cardText, detailText }),
        expanded,
      };
    },
  };
}

export async function scrapeInspirationIdeas(
  helpers: InspirationPageHelpers,
  log?: Logger,
  options?: ScrapeInspirationOptions,
): Promise<InspirationCaptureResult> {
  const startedAt = performance.now();
  const maxCards = Math.max(
    1,
    options?.maxCards ?? DEFAULT_INSPIRATION_SCRAPE_MAX,
  );
  await helpers.gotoAndEnsureSignedIn();
  await helpers.openInspirationFeed();

  const total = await helpers.expandFeed(maxCards);
  if (total === 0) {
    throw new StudioInspirationUiError(
      `No Inspiration idea cards found (url=${helpers.currentUrl()})`,
    );
  }

  log?.info("Inspiration idea cards found", {
    total,
    maxCards,
  });
  const ideas: CapturedInspirationIdea[] = [];
  let incomplete = false;

  for (let index = 0; index < total; index += 1) {
    const cardStartedAt = performance.now();
    log?.info("Capturing inspiration idea", {
      index: index + 1,
      total,
    });
    try {
      const captured = await helpers.captureCard(index);
      ideas.push(captured.idea);
      if (!captured.expanded) incomplete = true;
      log?.info("Inspiration idea captured", {
        index: index + 1,
        total,
        expanded: captured.expanded,
        durationMs: Math.round(performance.now() - cardStartedAt),
      });
    } catch (error) {
      incomplete = true;
      log?.warn("Inspiration card capture failed; continuing", {
        index: index + 1,
        total,
        durationMs: Math.round(performance.now() - cardStartedAt),
        error: errorMeta(error),
      });
    }
  }

  if (ideas.length === 0) {
    throw new StudioInspirationUiError(
      "All Inspiration idea cards failed to capture",
    );
  }

  const status = incomplete ? "partial" : "ok";
  log?.info("Inspiration scrape finished", {
    status,
    ideaCount: ideas.length,
    cardCount: total,
    maxCards,
    durationMs: Math.round(performance.now() - startedAt),
  });
  return { status, ideas };
}

export function wrapInspirationScrapeError(error: unknown): never {
  if (
    error instanceof StudioInspirationUiError ||
    error instanceof StudioSessionUnavailableError
  ) {
    throw error;
  }
  throw new StudioInspirationUiError(errorMessage(error));
}
