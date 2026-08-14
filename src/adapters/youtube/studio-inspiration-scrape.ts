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
  /** Best-effort Content→Inspiration URL; tab click still runs afterward. */
  inspirationPath: (channelId: string) =>
    `https://studio.youtube.com/channel/${channelId}/videos/inspiration`,
  contentNavNames: /^(content|contenuti)$/i,
  contentNavCandidates: [
    "ytcp-navigation-drawer a[href*='/videos']",
    "#menu-item-content",
  ],
  inspirationTabNames: /inspiration|ispirazione/i,
  inspirationTabCandidates: [
    "tp-yt-paper-tab",
    "ytcp-tab",
    "[role='tab']",
  ],
  ideaCardCandidates: [
    "[data-idea-id]",
    "ytcd-video-idea-card",
    "ytcd-inspiration-idea-card",
    "ytcd-inspiration-card",
    "[class*='idea-card']",
    "article:has-text('Audience interest')",
    "article:has-text('Interesse del pubblico')",
  ],
  detailPanel:
    "ytcd-idea-detail, ytcp-dialog[opened], [role='dialog'], ytcd-inspiration-detail",
  closeDetail:
    "button[aria-label='Close'], button[aria-label='Chiudi'], #close-button, ytcp-icon-button[aria-label='Close']",
} as const;

export const INSPIRATION_NAV_TIMEOUT_MS = 30_000;
export const INSPIRATION_CARD_TIMEOUT_MS = 8_000;

export type LocatorLike = {
  first(): LocatorLike;
  nth(index: number): LocatorLike;
  count(): Promise<number>;
  click(options?: { timeout?: number }): Promise<void>;
  innerText(): Promise<string>;
  getAttribute(name: string): Promise<string | null>;
  isVisible(): Promise<boolean>;
  waitFor(options?: { state?: string; timeout?: number }): Promise<void>;
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
};

export type CapturedInspirationCard = {
  idea: CapturedInspirationIdea;
  expanded: boolean;
};

export type InspirationPageHelpers = {
  gotoAndEnsureSignedIn(): Promise<void>;
  openInspirationFeed(): Promise<void>;
  countCards(): Promise<number>;
  captureCard(index: number): Promise<CapturedInspirationCard>;
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

async function dismissDetail(page: PageLike): Promise<void> {
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
    return firstNonEmptyLocator(page, INSPIRATION_SELECTORS.ideaCardCandidates);
  }

  return {
    async gotoAndEnsureSignedIn(): Promise<void> {
      await page.goto(INSPIRATION_SELECTORS.studioHome, {
        waitUntil: "domcontentloaded",
        timeout: INSPIRATION_NAV_TIMEOUT_MS,
      });
      if (page.url().includes("accounts.google.com")) {
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
            "Signed-in YouTube Studio chrome was not detected",
          );
        }
      }
    },

    async openInspirationFeed(): Promise<void> {
      const channelId = extractStudioChannelId(page.url());
      if (channelId) {
        await page.goto(INSPIRATION_SELECTORS.inspirationPath(channelId), {
          waitUntil: "domcontentloaded",
          timeout: INSPIRATION_NAV_TIMEOUT_MS,
        });
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
      }

      const clickedTab =
        (await clickFirstRole(
          page,
          ["tab"],
          INSPIRATION_SELECTORS.inspirationTabNames,
        )) ||
        (await clickMatchingLocator(
          page,
          INSPIRATION_SELECTORS.inspirationTabCandidates,
          INSPIRATION_SELECTORS.inspirationTabNames,
        ));
      if (!clickedTab && !/\/inspiration\b/i.test(page.url())) {
        throw new StudioInspirationUiError(
          "YouTube Studio Inspiration tab was not found",
        );
      }

      const cards = page.locator(INSPIRATION_SELECTORS.ideaCardCandidates.join(", "));
      try {
        await cards.first().waitFor({
          state: "visible",
          timeout: INSPIRATION_NAV_TIMEOUT_MS,
        });
      } catch {
        // Zero-card handling belongs to scrapeInspirationIdeas.
      }
    },

    async countCards(): Promise<number> {
      const list = await resolveCardList();
      return list ? list.count() : 0;
    },

    async captureCard(index: number): Promise<CapturedInspirationCard> {
      const list = await resolveCardList();
      if (!list) {
        throw new Error("Inspiration idea cards disappeared");
      }
      const card = list.nth(index);
      const studioId =
        (await card.getAttribute("data-idea-id")) ??
        (await card.getAttribute("data-id"));
      const cardText = await card.innerText();
      await card.click({ timeout: INSPIRATION_CARD_TIMEOUT_MS });

      let detailText = "";
      let expanded = false;
      try {
        const panel = page.locator(INSPIRATION_SELECTORS.detailPanel).first();
        await panel.waitFor({
          state: "visible",
          timeout: INSPIRATION_CARD_TIMEOUT_MS,
        });
        detailText = await panel.innerText();
        expanded = Boolean(detailText.trim());
      } catch {
        expanded = false;
      } finally {
        await dismissDetail(page);
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
): Promise<InspirationCaptureResult> {
  const startedAt = performance.now();
  await helpers.gotoAndEnsureSignedIn();
  await helpers.openInspirationFeed();

  const total = await helpers.countCards();
  if (total === 0) {
    throw new StudioInspirationUiError("No Inspiration idea cards found");
  }

  log?.info("Inspiration idea cards found", { total });
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
