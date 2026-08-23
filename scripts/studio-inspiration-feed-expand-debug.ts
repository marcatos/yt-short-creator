/**
 * Diagnose why Inspiration feed stays at ~6 cards after scroll.
 * Run: npx tsx scripts/studio-inspiration-feed-expand-debug.ts
 */
import { chromium } from "playwright";

import { withStudioLock } from "../src/adapters/youtube/studio-mutex";
import {
  resolveStudioProfileDir,
  studioPersistentContextOptions,
} from "../src/adapters/youtube/studio-profile";
import { INSPIRATION_SELECTORS } from "../src/adapters/youtube/studio-inspiration-scrape";

const CHANNEL_ID = "UC8GsJFUEMxF9Ke27mmJYkvA";

async function main(): Promise<void> {
  await withStudioLock(async () => {
    const context = await chromium.launchPersistentContext(
      resolveStudioProfileDir(process.env),
      studioPersistentContextOptions({ headed: true }),
    );
    try {
      for (const existing of context.pages()) {
        await existing.close().catch(() => undefined);
      }
      const page = await context.newPage();
      const url = INSPIRATION_SELECTORS.inspirationPath(CHANNEL_ID);
      console.log("goto", url);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page
        .locator("ytci-feed-idea-preview")
        .first()
        .waitFor({ state: "attached", timeout: 90_000 });
      await page.waitForTimeout(3_000);

      const snapshot = async (label: string) => {
        const info = await page.evaluate(() => {
          const cards = Array.from(
            document.querySelectorAll("ytci-feed-idea-preview"),
          );
          const buttons = Array.from(
            document.querySelectorAll("button, [role='button'], a"),
          )
            .map((el) => (el.textContent ?? "").trim().replace(/\s+/g, " "))
            .filter((t) =>
              /more|altr|mostra|vedi|carica|load|next|avanti|idea/i.test(t),
            )
            .slice(0, 40);
          const scrollers = Array.from(document.querySelectorAll("*"))
            .filter((el) => {
              const style = window.getComputedStyle(el);
              const overflowY = style.overflowY;
              return (
                (overflowY === "auto" || overflowY === "scroll") &&
                (el as HTMLElement).scrollHeight >
                  (el as HTMLElement).clientHeight + 40
              );
            })
            .map((el) => ({
              tag: el.tagName.toLowerCase(),
              id: el.id,
              className: String(el.className).slice(0, 80),
              scrollHeight: (el as HTMLElement).scrollHeight,
              clientHeight: (el as HTMLElement).clientHeight,
              scrollTop: (el as HTMLElement).scrollTop,
            }))
            .slice(0, 15);
          return {
            url: location.href,
            cardCount: cards.length,
            cardTitles: cards.map((c) =>
              (c.textContent ?? "").trim().split("\n")[0]?.slice(0, 80),
            ),
            buttons,
            scrollers,
            bodyScroll: {
              scrollHeight: document.scrollingElement?.scrollHeight,
              clientHeight: document.scrollingElement?.clientHeight,
              scrollTop: document.scrollingElement?.scrollTop,
            },
          };
        });
        console.log(`\n=== ${label} ===`);
        console.log(JSON.stringify(info, null, 2));
        return info;
      };

      await snapshot("initial");

      for (let i = 0; i < 8; i += 1) {
        await page.evaluate(() => {
          const candidates = Array.from(document.querySelectorAll("*")).filter(
            (el) => {
              const style = window.getComputedStyle(el);
              const overflowY = style.overflowY;
              return (
                (overflowY === "auto" || overflowY === "scroll") &&
                (el as HTMLElement).scrollHeight >
                  (el as HTMLElement).clientHeight + 40
              );
            },
          ) as HTMLElement[];
          for (const el of candidates) {
            el.scrollTop = el.scrollHeight;
          }
          window.scrollTo(0, document.body.scrollHeight);
        });
        const last = page.locator("ytci-feed-idea-preview").last();
        await last.scrollIntoViewIfNeeded().catch(() => undefined);
        await page.mouse.wheel(0, 2400);
        await page.waitForTimeout(1500);
        const count = await page.locator("ytci-feed-idea-preview").count();
        console.log(`after scroll round ${i + 1}: cards=${count}`);
      }

      await snapshot("after-scroll");

      // Try clicking likely "more" controls
      const clicked = await page.evaluate(() => {
        const els = Array.from(
          document.querySelectorAll("button, [role='button'], a, tp-yt-paper-button"),
        );
        for (const el of els) {
          const t = (el.textContent ?? "").trim().replace(/\s+/g, " ");
          if (/show more|see more|load more|mostra di più|vedi di più|altri|more ideas/i.test(t)) {
            (el as HTMLElement).click();
            return t;
          }
        }
        return null;
      });
      console.log("clicked more control:", clicked);
      if (clicked) {
        await page.waitForTimeout(3000);
        await snapshot("after-more-click");
      }
    } finally {
      await context.close();
    }
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
