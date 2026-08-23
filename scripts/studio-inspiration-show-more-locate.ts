/**
 * Locate the Show More control in the Inspiration feed DOM.
 * Run: npx tsx scripts/studio-inspiration-show-more-locate.ts
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
      await page.waitForTimeout(3_000);

      // Scroll main to bottom like first probe
      for (let i = 0; i < 3; i += 1) {
        await page.locator("#main").evaluate((el) => {
          (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
        });
        await page.mouse.wheel(0, 2000);
        await page.waitForTimeout(1000);
      }

      const found = await page.evaluate(`(() => {
        const matches = [];
        const walk = (root, path) => {
          const nodes = root.querySelectorAll("*");
          for (const el of Array.from(nodes)) {
            const text = (el.textContent || "").trim().replace(/\\s+/g, " ");
            if (/^(show more|mostra altro)$/i.test(text) && text.length < 40) {
              matches.push({
                path,
                tag: el.tagName.toLowerCase(),
                id: el.id,
                role: el.getAttribute("role"),
                className: String(el.className).slice(0, 120),
                ariaLabel: el.getAttribute("aria-label"),
                text,
              });
            }
            if (el.shadowRoot) {
              walk(el.shadowRoot, path + ">" + el.tagName.toLowerCase() + "#shadow");
            }
          }
        };
        walk(document, "document");
        return matches.slice(0, 20);
      })()`);
      console.log("exact Show More matches:", JSON.stringify(found, null, 2));

      // Also try text locator
      const textBtn = page.locator("text=/^(Show More|Mostra altro)$/i");
      console.log("text locator count", await textBtn.count());
      if ((await textBtn.count()) > 0) {
        await textBtn.first().click({ timeout: 5_000 });
        await page.waitForTimeout(2500);
        console.log(
          "cards after text click",
          await page.locator("ytci-feed-idea-preview").count(),
        );
      }

      // Playwright role again after scroll
      const roleBtn = page.getByRole("button", {
        name: /show more|mostra altro/i,
      });
      console.log("role locator count", await roleBtn.count());
    } finally {
      await context.close();
    }
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
