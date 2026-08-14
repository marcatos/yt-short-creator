/**
 * Debug Studio Inspiration navigation + card hydration.
 * npx tsx scripts/studio-inspiration-nav-debug.ts
 */
import { chromium } from "playwright";

import { withStudioLock } from "../src/adapters/youtube/studio-mutex";
import {
  resolveStudioProfileDir,
  studioPersistentContextOptions,
} from "../src/adapters/youtube/studio-profile";
import {
  createPlaywrightInspirationHelpers,
  INSPIRATION_SELECTORS,
} from "../src/adapters/youtube/studio-inspiration-scrape";

const CHANNEL_ID = "UC8GsJFUEMxF9Ke27mmJYkvA";

async function main(): Promise<void> {
  await withStudioLock(async () => {
    const context = await chromium.launchPersistentContext(
      resolveStudioProfileDir(process.env),
      studioPersistentContextOptions({ headed: true }),
    );
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      const helpers = createPlaywrightInspirationHelpers(page);

      console.log("1 gotoAndEnsureSignedIn");
      await helpers.gotoAndEnsureSignedIn();
      console.log("2 after sign-in", page.url());

      const target = INSPIRATION_SELECTORS.inspirationPath(CHANNEL_ID);
      console.log("3 goto", target);
      await page.goto(target, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      console.log("4 after content/inspiration", page.url());
      await page.waitForTimeout(3_000);
      console.log("5 after 3s", page.url());

      let count = await page.locator("ytci-feed-idea-preview").count();
      let loading = await page
        .locator(".ytciFeedIdeaPreviewLoadingPlaceholder")
        .count();
      console.log("6 cards", { count, loading });

      for (let i = 0; i < 20; i += 1) {
        await page.waitForTimeout(2_000);
        count = await page.locator("ytci-feed-idea-preview").count();
        loading = await page
          .locator(".ytciFeedIdeaPreviewLoadingPlaceholder")
          .count();
        const texts = await page
          .locator("ytci-feed-idea-preview")
          .allInnerTexts();
        const nonEmpty = texts.filter((t) => t.trim().length > 0).length;
        console.log(`7 tick ${i + 1}`, {
          url: page.url(),
          count,
          loading,
          nonEmpty,
          sample: texts
            .map((t) => t.replace(/\s+/g, " ").trim().slice(0, 60))
            .filter(Boolean)
            .slice(0, 3),
        });
        if (nonEmpty > 0) break;
      }

      const body = (await page.locator("body").innerText()).slice(0, 1_200);
      console.log("8 body preview\n", body);

      const firstHtml = await page
        .locator("ytci-feed-idea-preview")
        .first()
        .evaluate((el) => el.outerHTML.slice(0, 1_200))
        .catch((error: unknown) =>
          error instanceof Error ? error.message : String(error),
        );
      console.log("9 first card html\n", firstHtml);

      console.log("10 openInspirationFeed via helpers");
      try {
        await helpers.openInspirationFeed();
        console.log("11 helpers ok", page.url(), await helpers.countCards());
      } catch (error) {
        console.log(
          "11 helpers failed",
          page.url(),
          error instanceof Error ? error.message : error,
        );
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
