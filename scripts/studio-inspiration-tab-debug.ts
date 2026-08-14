/**
 * Dump Content page tab DOM after Inspiration URL redirect.
 * npx tsx scripts/studio-inspiration-tab-debug.ts
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
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(INSPIRATION_SELECTORS.studioHome, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      console.log("after home", page.url());

      const target = INSPIRATION_SELECTORS.inspirationPath(CHANNEL_ID);
      await page.goto(target, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForTimeout(4_000);
      console.log("after inspiration goto", page.url());

      const info = await page.evaluate(() => {
        const tabs = Array.from(
          document.querySelectorAll(
            "[role='tab'], tp-yt-paper-tab, ytcp-tab, a[href*='inspiration']",
          ),
        ).map((el) => ({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role"),
          href: (el as HTMLAnchorElement).href ?? null,
          text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
          aria: el.getAttribute("aria-label"),
          selected: el.getAttribute("aria-selected"),
          className: String(el.className).slice(0, 120),
        }));
        const allWithIspirazione = Array.from(
          document.querySelectorAll("*"),
        )
          .filter((el) =>
            /ispirazione|inspiration/i.test(el.textContent ?? ""),
          )
          .slice(0, 30)
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent ?? "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 60),
            href: (el as HTMLAnchorElement).href ?? null,
          }));
        return { tabs, allWithIspirazione };
      });
      console.log(JSON.stringify(info, null, 2));

      // Try explicit click strategies
      const strategies: Array<[string, () => Promise<boolean>]> = [
        [
          "getByRole tab Ispirazione",
          async () => {
            const loc = page.getByRole("tab", { name: /ispirazione|inspiration/i });
            if ((await loc.count()) === 0) return false;
            await loc.first().click({ timeout: 5_000 });
            return true;
          },
        ],
        [
          "href content/inspiration",
          async () => {
            const loc = page.locator("a[href*='/content/inspiration']");
            if ((await loc.count()) === 0) return false;
            await loc.first().click({ timeout: 5_000 });
            return true;
          },
        ],
        [
          "text=Ispirazione",
          async () => {
            const loc = page.getByText("Ispirazione", { exact: true });
            if ((await loc.count()) === 0) return false;
            await loc.first().click({ timeout: 5_000 });
            return true;
          },
        ],
        [
          "paper-tab filter",
          async () => {
            const tabs = page.locator("tp-yt-paper-tab");
            const n = await tabs.count();
            for (let i = 0; i < n; i += 1) {
              const text = (await tabs.nth(i).innerText()).trim();
              if (/ispirazione|inspiration/i.test(text)) {
                await tabs.nth(i).click({ timeout: 5_000 });
                return true;
              }
            }
            return false;
          },
        ],
      ];

      for (const [name, fn] of strategies) {
        try {
          const ok = await fn();
          console.log("strategy", name, ok, "url", page.url());
          if (ok && /inspiration/i.test(page.url())) {
            const count = await page.locator("ytci-feed-idea-preview").count();
            console.log("cards after click", count);
            break;
          }
        } catch (error) {
          console.log(
            "strategy failed",
            name,
            error instanceof Error ? error.message : error,
          );
        }
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
