import { describe, expect, it } from "vitest";

import {
  resolveChromeExecutablePath,
  resolveStudioBrowserChannel,
  resolveStudioCdpPort,
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

  it("passes channel and automation-softening args into context options", () => {
    expect(
      studioPersistentContextOptions({
        headed: true,
        env: {},
      }),
    ).toMatchObject({
      headless: false,
      channel: "chrome",
      ignoreDefaultArgs: ["--enable-automation"],
      args: ["--disable-blink-features=AutomationControlled"],
    });
  });

  it("defaults CDP port to 9222", () => {
    expect(resolveStudioCdpPort({})).toBe(9222);
  });

  it("defaults Studio automation to headed", async () => {
    const { isStudioHeaded } = await import(
      "@/src/adapters/youtube/studio-profile"
    );
    expect(isStudioHeaded({})).toBe(true);
    expect(isStudioHeaded({ YOUTUBE_STUDIO_HEADED: "0" })).toBe(false);
  });
});
