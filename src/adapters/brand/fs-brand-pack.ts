import fs from "node:fs/promises";
import path from "node:path";

import type { BrandPack, BrandPackPort, BrandTokens } from "@/src/ports/brand-pack";

const BRAND_IDENTITY_DIR = "brand-identity";
const TOKENS_FILE = "brand-tokens.json";
const LOGO_STACKED_REL = path.join(
  BRAND_IDENTITY_DIR,
  "01-primary-stacked",
  "primary_stacked_mono_white.png",
);
const STORY_TEMPLATE_REL = path.join(
  BRAND_IDENTITY_DIR,
  "07-social",
  "story_1080x1920.png",
);

type RawBrandTokens = {
  colors: {
    carbon: string;
    ice: string;
  };
  racing_colors: {
    rosso_corsa: {
      hex: string;
    };
  };
};

function mapTokens(raw: RawBrandTokens): BrandTokens {
  return {
    colors: {
      carbon: raw.colors.carbon,
      ice: raw.colors.ice,
    },
    racingColors: {
      rossoCorsa: raw.racing_colors.rosso_corsa.hex,
    },
  };
}

async function readTokensFile(tokensPath: string): Promise<RawBrandTokens> {
  try {
    const contents = await fs.readFile(tokensPath, "utf8");
    return JSON.parse(contents) as RawBrandTokens;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(
        `Brand tokens file not found at ${tokensPath}. Set BRAND_ROOT to your smarcato42-racing checkout.`,
      );
    }

    throw error;
  }
}

export function createFsBrandPack(deps: {
  brandRoot: string;
}): BrandPackPort {
  const tokensPath = path.join(
    deps.brandRoot,
    BRAND_IDENTITY_DIR,
    TOKENS_FILE,
  );

  return {
    async resolve(): Promise<BrandPack> {
      const raw = await readTokensFile(tokensPath);
      const tokens = mapTokens(raw);

      return {
        tokens,
        logoStackedPath: path.join(deps.brandRoot, LOGO_STACKED_REL),
        storyTemplatePath: path.join(deps.brandRoot, STORY_TEMPLATE_REL),
        accentHex: tokens.racingColors.rossoCorsa,
      };
    },
  };
}
