import { describe, expect, it } from "vitest";

import {
  withFullVideoLink,
  youtubeWatchUrl,
} from "@/src/domain/full-video-link";

describe("withFullVideoLink", () => {
  it("appends youtu.be link when missing", () => {
    expect(withFullVideoLink("A fast clip", "abc123")).toBe(
      "A fast clip\n\nFull video: https://youtu.be/abc123",
    );
  });

  it("is idempotent when link already present", () => {
    const once = withFullVideoLink("Hook", "abc123");
    expect(withFullVideoLink(once, "abc123")).toBe(once);
  });

  it("builds short watch urls", () => {
    expect(youtubeWatchUrl("xyz")).toBe("https://youtu.be/xyz");
  });
});
