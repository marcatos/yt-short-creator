import { z } from "zod";

import {
  analysisContextForEditorial,
  assembleDescription,
  TITLE_PRIORITY_GUIDANCE,
  type EditorialPackage,
} from "@/src/domain/editorial";
import {
  RACE_METADATA_STYLE,
  RACE_VOICE_OVER_STYLE,
} from "@/src/domain/race-copy-style";
import type { RaceAnalysis } from "@/src/domain/race-analysis";
import type { HardwareConfigPort } from "@/src/ports/hardware-config";
import type { LlmPort } from "@/src/ports/llm";
import type { Logger } from "@/src/ports/logger";

const editorialSchema = z.object({
  titleIt: z.string().trim().min(1).max(100),
  titleEn: z.string().trim().min(1).max(100),
  hookIt: z.string().trim().min(1),
  hookEn: z.string().trim().min(1),
  storyIt: z.string().trim().min(1),
  storyEn: z.string().trim().min(1),
  ctaIt: z.string().trim().min(1),
  ctaEn: z.string().trim().min(1),
  voiceOverIt: z.string().trim().min(1),
  voiceOverEn: z.string().trim().min(1),
  hashtags: z.array(z.string().trim().min(1)).max(8),
  thumbnailUniversal: z.string().trim().min(1).nullable(),
  thumbnailIt: z.string().trim().min(1).nullable(),
  thumbnailEn: z.string().trim().min(1).nullable(),
  thumbnailRationale: z.string().trim().min(1),
});

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "titleIt",
    "titleEn",
    "hookIt",
    "hookEn",
    "storyIt",
    "storyEn",
    "ctaIt",
    "ctaEn",
    "voiceOverIt",
    "voiceOverEn",
    "hashtags",
    "thumbnailUniversal",
    "thumbnailIt",
    "thumbnailEn",
    "thumbnailRationale",
  ],
  properties: {
    titleIt: { type: "string" },
    titleEn: { type: "string" },
    hookIt: { type: "string" },
    hookEn: { type: "string" },
    storyIt: { type: "string" },
    storyEn: { type: "string" },
    ctaIt: { type: "string" },
    ctaEn: { type: "string" },
    voiceOverIt: { type: "string" },
    voiceOverEn: { type: "string" },
    hashtags: { type: "array", items: { type: "string" }, maxItems: 8 },
    thumbnailUniversal: { type: ["string", "null"] },
    thumbnailIt: { type: ["string", "null"] },
    thumbnailEn: { type: ["string", "null"] },
    thumbnailRationale: { type: "string" },
  },
} satisfies Record<string, unknown>;

type Dependencies = {
  llm: LlmPort;
  hardware: HardwareConfigPort;
  logger: Logger;
};

export type EditorialLocalize = (input: {
  analysis: RaceAnalysis;
}) => Promise<EditorialPackage>;

export function createEditorialLocalize(
  deps: Dependencies,
): EditorialLocalize {
  const log = deps.logger.child({ operation: "editorialLocalize" });

  return async ({ analysis }) => {
    const startedAt = performance.now();
    log.info("Editorial localize started", {
      whyWatch: analysis.whyWatch.slice(0, 120),
      mainStoryline: analysis.mainStoryline.slice(0, 120),
    });

    const hardware = await deps.hardware.get();
    const response = await deps.llm.complete({
      system: [
        RACE_METADATA_STYLE,
        RACE_VOICE_OVER_STYLE,
        TITLE_PRIORITY_GUIDANCE,
        "Produce independent IT and EN titles (not literal translation).",
        "EN voiceOverEn is editorial localization of the Italian race story: same facts and approximate duration, natural simracing English — not a calque.",
        "Descriptions: hook (2-3 lines) + story paragraphs separately; race info, opponent-invite, and hardware are appended by the system — do NOT invent hardware specs or replay contact emails.",
        "Thumbnail text must be VERY short; prefer universal (P18 → P8) when it works in both languages.",
        "CTA: brief subscribe only (system adds the rival/replay invite). Hashtags: few and relevant.",
      ].join("\n"),
      user: analysisContextForEditorial(analysis),
      jsonSchema: responseJsonSchema,
    });

    const parsed = editorialSchema.parse(JSON.parse(response));
    const descriptionIt = assembleDescription({
      language: "it",
      hook: parsed.hookIt,
      story: parsed.storyIt,
      cta: parsed.ctaIt,
      analysis,
      hardware,
      hashtags: parsed.hashtags,
    });
    const descriptionEn = assembleDescription({
      language: "en",
      hook: parsed.hookEn,
      story: parsed.storyEn,
      cta: parsed.ctaEn,
      analysis,
      hardware,
      hashtags: parsed.hashtags,
    });

    const result: EditorialPackage = {
      it: {
        language: "it",
        title: parsed.titleIt,
        description: descriptionIt,
        voiceOverScript: parsed.voiceOverIt,
      },
      en: {
        language: "en",
        title: parsed.titleEn,
        description: descriptionEn,
        voiceOverScript: parsed.voiceOverEn,
      },
      thumbnailConcept: {
        universalText: parsed.thumbnailUniversal,
        textIt: parsed.thumbnailIt,
        textEn: parsed.thumbnailEn,
        rationale: parsed.thumbnailRationale,
      },
    };

    log.info("Editorial localize completed", {
      titleIt: result.it.title,
      titleEn: result.en.title,
      hasHardwareIt: descriptionIt.includes("LA MIA POSTAZIONE SIM RACING"),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return result;
  };
}
