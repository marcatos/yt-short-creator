import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFsBrandPack } from "@/src/adapters/brand/fs-brand-pack";

const DEFAULT_BRAND_ROOT =
  process.env.BRAND_ROOT ??
  "C:\\Users\\simot\\Documents\\Projects\\smarcato42-racing";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("createFsBrandPack", () => {
  it("resolves S.Marcato 42 tokens and asset paths from BRAND_ROOT", async () => {
    const brandPack = createFsBrandPack({ brandRoot: DEFAULT_BRAND_ROOT });
    const pack = await brandPack.resolve();

    expect(pack.tokens.colors.carbon).toBe("#08080A");
    expect(pack.tokens.racingColors.rossoCorsa).toBe("#E10600");
    expect(pack.accentHex).toBe("#E10600");

    expect(fs.existsSync(pack.logoStackedPath)).toBe(true);
    expect(fs.existsSync(pack.storyTemplatePath)).toBe(true);
    expect(pack.logoStackedPath).toContain("primary_stacked_mono_white.png");
    expect(pack.storyTemplatePath).toContain("story_1080x1920.png");
  });

  it("throws a clear error when brand-tokens.json is missing", async () => {
    const brandRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "yt-short-creator-brand-"),
    );
    tempDirs.push(brandRoot);

    const brandPack = createFsBrandPack({ brandRoot });

    await expect(brandPack.resolve()).rejects.toThrow(
      /brand-tokens\.json/i,
    );
  });
});
