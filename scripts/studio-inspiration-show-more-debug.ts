/**
 * Click Show More / Mostra altro until cards stop growing.
 * Run: npx tsx scripts/studio-inspiration-show-more-debug.ts
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
      await page.waitForTimeout(2_000);

      let previous = await page.locator("ytci-feed-idea-preview").count();
      console.log("start cards", previous);

      for (let round = 0; round < 30; round += 1) {
        const btn = page.getByRole("button", {
          name: /^(show more|mostra altro)$/i,
        });
        const count = await btn.count();
        if (count === 0) {
          console.log("no Show More button; stop");
          break;
        }
        await btn.first().click({ timeout: 5_000 });
        await page.waitForTimeout(2_000);
        const next = await page.locator("ytci-feed-idea-preview").count();
        console.log(`round ${round + 1}: cards ${previous} -> ${next}`);
        if (next <= previous) {
          console.log("no growth; stop");
          break;
        }
        previous = next;
      }

      const titles = await page.evaluate(() =>
        Array.from(document.querySelectorAll("ytci-feed-idea-preview")).map(
          (el) => (el.textContent ?? "").trim().split("\n")[0]?.slice(0, 100),
        ),
      );
      console.log("final count", titles.length);
      console.log(titles);
    } finally {
      await context.close();
    }
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
