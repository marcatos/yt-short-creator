/**
 * Wait for feed hydration then find/click Show More repeatedly.
 * Run: npx tsx scripts/studio-inspiration-show-more-debug2.ts
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
      await page.goto(INSPIRATION_SELECTORS.inspirationPath(CHANNEL_ID), {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page
        .locator("ytci-feed-idea-preview")
        .first()
        .waitFor({ state: "attached", timeout: 90_000 });

      // Wait until card titles hydrate (non-empty)
      for (let i = 0; i < 30; i += 1) {
        const ready = await page.evaluate(`(() => {
          const cards = Array.from(document.querySelectorAll("ytci-feed-idea-preview"));
          return cards.filter((c) => ((c.textContent || "").trim().length > 0)).length;
        })()`);
        console.log("hydrated cards", ready);
        if (ready >= 3) break;
        await page.waitForTimeout(1000);
      }

      // Scroll main to bottom
      await page.locator("#main").evaluate((el) => {
        (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
      });
      await page.waitForTimeout(1500);

      const dumpButtons = async () =>
        page.evaluate(`(() => {
          return Array.from(document.querySelectorAll("button, [role='button'], a, ytcp-button, tp-yt-paper-button"))
            .map((el) => ({
              tag: el.tagName.toLowerCase(),
              role: el.getAttribute("role"),
              aria: el.getAttribute("aria-label"),
              text: ((el.textContent || "").trim().replace(/\\s+/g, " ")).slice(0, 80),
            }))
            .filter((x) => /more|altro|altr/i.test(x.text + " " + (x.aria || "")))
            .slice(0, 30);
        })()`);

      console.log("candidate controls", JSON.stringify(await dumpButtons(), null, 2));

      for (let round = 0; round < 25; round += 1) {
        await page.locator("#main").evaluate((el) => {
          (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
        });
        await page.waitForTimeout(500);

        const clicked = await page.evaluate(`(() => {
          const els = Array.from(document.querySelectorAll("button, [role='button'], a, ytcp-button, tp-yt-paper-button"));
          for (const el of els) {
            const text = ((el.textContent || "").trim().replace(/\\s+/g, " "));
            const aria = (el.getAttribute("aria-label") || "").trim();
            if (/^(show more|mostra altro)$/i.test(text) || /^(show more|mostra altro)$/i.test(aria)) {
              el.click();
              return { text, aria, tag: el.tagName.toLowerCase() };
            }
          }
          return null;
        })()`);

        if (!clicked) {
          console.log("no Show More; stop at round", round + 1);
          console.log("remaining", JSON.stringify(await dumpButtons(), null, 2));
          break;
        }
        console.log("clicked", clicked);
        await page.waitForTimeout(2000);
        const count = await page.locator("ytci-feed-idea-preview").count();
        console.log("cards now", count);
      }

      const titles = await page.evaluate(`(() =>
        Array.from(document.querySelectorAll("ytci-feed-idea-preview")).map((el) =>
          ((el.textContent || "").trim().split("\\n")[0] || "").slice(0, 90)
        )
      )()`);
      console.log("final", (titles as string[]).length, titles);
    } finally {
      await context.close();
    }
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
