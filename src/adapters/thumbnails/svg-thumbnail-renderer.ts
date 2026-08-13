import fs from "node:fs/promises";
import path from "node:path";

import type { ThumbnailConcept } from "@/src/domain/youtube-metadata";
import type { Logger } from "@/src/ports/logger";

/**
 * Writes a lightweight SVG thumbnail concept (text-only) for operator review.
 * Full generative art can replace this adapter later.
 */
export type ThumbnailRenderInput = {
  concept: ThumbnailConcept;
  outputDir: string;
  /** Prefer universal text when present. */
  preferUniversal?: boolean;
};

export type ThumbnailRenderResult = {
  universalPath: string | null;
  itPath: string | null;
  enPath: string | null;
};

function svgFor(text: string): string {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1220"/>
      <stop offset="100%" stop-color="#1a2333"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <text x="640" y="380" fill="#f4f7fb" font-size="96" font-family="Arial Black, Arial, sans-serif"
        font-weight="700" text-anchor="middle">${escaped}</text>
</svg>
`;
}

export function createSvgThumbnailRenderer(deps: { logger: Logger }) {
  const log = deps.logger.child({ component: "SvgThumbnailRenderer" });

  return {
    async render(input: ThumbnailRenderInput): Promise<ThumbnailRenderResult> {
      const startedAt = performance.now();
      await fs.mkdir(input.outputDir, { recursive: true });
      const preferUniversal = input.preferUniversal !== false;
      let universalPath: string | null = null;
      let itPath: string | null = null;
      let enPath: string | null = null;

      if (preferUniversal && input.concept.universalText) {
        universalPath = path.join(input.outputDir, "thumbnail_universal.svg");
        await fs.writeFile(
          universalPath,
          svgFor(input.concept.universalText),
          "utf8",
        );
      } else {
        if (input.concept.textIt) {
          itPath = path.join(input.outputDir, "thumbnail_it.svg");
          await fs.writeFile(itPath, svgFor(input.concept.textIt), "utf8");
        }
        if (input.concept.textEn) {
          enPath = path.join(input.outputDir, "thumbnail_en.svg");
          await fs.writeFile(enPath, svgFor(input.concept.textEn), "utf8");
        }
        if (!itPath && !enPath && input.concept.universalText) {
          universalPath = path.join(input.outputDir, "thumbnail_universal.svg");
          await fs.writeFile(
            universalPath,
            svgFor(input.concept.universalText),
            "utf8",
          );
        }
      }

      log.info("Thumbnail concepts rendered", {
        universalPath,
        itPath,
        enPath,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return { universalPath, itPath, enPath };
    },
  };
}
