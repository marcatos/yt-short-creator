/**
 * Headed probe: open Studio Inspiration and dump DOM clues for selector tuning.
 * Run: npx tsx scripts/studio-inspiration-probe.ts
 */
import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import { withStudioLock } from "../src/adapters/youtube/studio-mutex";
import {
  resolveStudioProfileDir,
  studioPersistentContextOptions,
} from "../src/adapters/youtube/studio-profile";
import { INSPIRATION_SELECTORS } from "../src/adapters/youtube/studio-inspiration-scrape";

const CHANNEL_ID = "UC8GsJFUEMxF9Ke27mmJYkvA";
const OUT_DIR = path.resolve("data", "studio-inspiration-probe");

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profileDir = resolveStudioProfileDir(process.env);

  await withStudioLock(async () => {
    const context = await chromium.launchPersistentContext(
      profileDir,
      studioPersistentContextOptions({ headed: true }),
    );
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      const url = INSPIRATION_SELECTORS.inspirationPath(CHANNEL_ID);
      console.log(`Opening ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(5_000);

      const finalUrl = page.url();
      const title = await page.title();
      const probe = await page.evaluate(() => {
        const tags = Array.from(document.querySelectorAll("*"))
          .map((el) => el.tagName.toLowerCase())
          .filter((tag) => tag.startsWith("yt"))
          .reduce<Record<string, number>>((acc, tag) => {
            acc[tag] = (acc[tag] ?? 0) + 1;
            return acc;
          }, {});
        const topTags = Object.entries(tags)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 40);
        const bodyText = (document.body?.innerText ?? "").slice(0, 4_000);
        const hrefs = Array.from(document.querySelectorAll("a[href]"))
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((href) => /inspiration|ispirazione|idea/i.test(href))
          .slice(0, 20);
        return { topTags, bodyText, hrefs };
      });

      const report = {
        finalUrl,
        title,
        topTags: probe.topTags,
        hrefs: probe.hrefs,
        bodyText: probe.bodyText,
      };
      const reportPath = path.join(OUT_DIR, "probe.json");
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
      await page.screenshot({
        path: path.join(OUT_DIR, "inspiration.png"),
        fullPage: true,
      });
      console.log(`Wrote ${reportPath}`);
      console.log(`URL: ${finalUrl}`);
      console.log("Top yt* tags:", probe.topTags.slice(0, 15));
      console.log("Body preview:\n", probe.bodyText.slice(0, 800));
    } finally {
      await context.close();
    }
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
