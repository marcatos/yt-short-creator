import { describe, expect, it } from "vitest";

import {
  resolveStudioBrowserChannel,
  studioPersistentContextOptions,
} from "@/src/adapters/youtube/studio-profile";

describe("studio browser channel", () => {
  it("defaults to installed Google Chrome", () => {
    expect(resolveStudioBrowserChannel({})).toBe("chrome");
  });

  it("allows overriding the Playwright channel", () => {
    expect(
      resolveStudioBrowserChannel({
        YOUTUBE_STUDIO_BROWSER_CHANNEL: "msedge",
      }),
    ).toBe("msedge");
  });

  it("passes channel into persistent context options", () => {
    expect(
      studioPersistentContextOptions({
        headed: true,
        env: {},
      }),
    ).toMatchObject({
      headless: false,
      channel: "chrome",
    });
  });
});
