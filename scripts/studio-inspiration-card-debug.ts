import { chromium } from "playwright";

import { withStudioLock } from "../src/adapters/youtube/studio-mutex";
import {
  resolveStudioProfileDir,
  studioPersistentContextOptions,
} from "../src/adapters/youtube/studio-profile";

async function main(): Promise<void> {
  await withStudioLock(async () => {
    const context = await chromium.launchPersistentContext(
      resolveStudioProfileDir(process.env),
      studioPersistentContextOptions({ headed: true }),
    );
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(
        "https://studio.youtube.com/channel/UC8GsJFUEMxF9Ke27mmJYkvA/content/inspiration",
        { waitUntil: "domcontentloaded", timeout: 60_000 },
      );
      await page
        .locator("ytci-feed-idea-preview")
        .first()
        .waitFor({ state: "attached", timeout: 60_000 });
      const info = await page.evaluate(() => {
        const nodes = Array.from(
          document.querySelectorAll("ytci-feed-idea-preview"),
        );
        return nodes.map((el) => {
          const any = el as HTMLElement & { shadowRoot?: ShadowRoot | null };
          return {
            innerText: any.innerText?.slice(0, 160) ?? "",
            textContent: any.textContent?.slice(0, 160) ?? "",
            shadow: any.shadowRoot
              ? (any.shadowRoot.textContent?.slice(0, 240) ?? "")
              : null,
            html: any.innerHTML?.slice(0, 240) ?? "",
            childCount: any.children.length,
          };
        });
      });
      console.log("card probe", JSON.stringify(info, null, 2));

      await page.goto("https://studio.youtube.com", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      console.log("after home", page.url());
      await page.goto(
        "https://studio.youtube.com/channel/UC8GsJFUEMxF9Ke27mmJYkvA/content/inspiration",
        { waitUntil: "domcontentloaded", timeout: 60_000 },
      );
      await page.waitForTimeout(8_000);
      console.log(
        "after reinsp",
        page.url(),
        "count",
        await page.locator("ytci-feed-idea-preview").count(),
      );
    } finally {
      await context.close();
    }
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
