import { describe, expect, it } from "vitest";

import {
  loadCanonicalReplayConfig,
  pathsMatch,
  resolveCanonicalMediaPath,
} from "@/src/domain/canonical-replay";

describe("canonical-replay", () => {
  it("loads session and resolves media path from config", () => {
    const config = loadCanonicalReplayConfig();
    expect(config.sessionId).toBe("3ba5532d-3812-4868-82e7-9053c90bbf12");
    expect(config.mediaPath).toContain("2026-08-21-rec2k-merged.mkv");
    expect(resolveCanonicalMediaPath()).toBe(config.mediaPath);
  });

  it("pathsMatch is case-insensitive on Windows-style paths", () => {
    expect(
      pathsMatch("C:/foo/bar.mkv", "c:\\foo\\bar.mkv"),
    ).toBe(true);
  });
});
