import { z } from "zod";

import {
  SPORTS_COMMENTARY_STYLE,
  type VoiceOverMode,
} from "@/src/domain/commentary-style";
import { PLAY_BY_PLAY_COMMENTARY_RULES } from "@/src/domain/commentary-chapter-scene";
import type { CommentarySpeechCue } from "@/src/domain/commentary-speech-cues";
import { analysisContextForEditorial } from "@/src/domain/editorial";
import { RACE_METADATA_STYLE } from "@/src/domain/race-copy-style";
import type { RaceAnalysis } from "@/src/domain/race-analysis";
import type { LlmPort } from "@/src/ports/llm";
import type { Logger } from "@/src/ports/logger";

const cueScriptSchema = z.object({
  cueId: z.string().trim().min(1),
  scriptIt: z.string().trim().min(1),
  scriptEn: z.string().trim().min(1),
});

const cuedScriptsSchema = z.object({
  cues: z.array(cueScriptSchema).min(1),
});

type CueScript = z.infer<typeof cueScriptSchema>;

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["cues"],
  properties: {
    cues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["cueId", "scriptIt", "scriptEn"],
        properties: {
          cueId: { type: "string" },
          scriptIt: { type: "string" },
          scriptEn: { type: "string" },
        },
      },
    },
  },
} satisfies Record<string, unknown>;

const CUED_SYSTEM_PROMPT = `${SPORTS_COMMENTARY_STYLE}

${PLAY_BY_PLAY_COMMENTARY_RULES}

Write bilingual spoken lines for a full simracing race upload — ONE short line per supplied speechCue.
Each cue has a fixed targetMs on the video timeline: the line will be spoken starting at that instant.
Describe only what happens at that cue (corner approach, straight, overtake, battle, incident, lap, etc.).
Italian first; English is an adaptation (same facts and energy, not a calque).
Spoken text only — no timestamps in the script (${RACE_METADATA_STYLE} applies to titles elsewhere).
Respect targetWordsMin–targetWordsMax per cue; shorter is better than filler.
Return exactly one script per input cueId, same order.`;

type Dependencies = {
  llm: LlmPort;
  logger: Logger;
};

export type GenerateCuedRaceScripts = (input: {
  analysis: RaceAnalysis;
  cues: CommentarySpeechCue[];
  voiceOverMode: VoiceOverMode;
}) => Promise<CueScript[]>;

function cuePayload(cues: CommentarySpeechCue[]): Record<string, unknown>[] {
  return cues.map((cue) => ({
    cueId: cue.cueId,
    targetMs: cue.targetMs,
    targetClock: cue.label,
    kind: cue.kind,
    summary: cue.summary,
    involvingFocusCar: cue.involvingFocusCar,
    targetWordsMin: cue.targetWordsMin,
    targetWordsMax: cue.targetWordsMax,
  }));
}

export function alignCueScripts(
  scripts: CueScript[],
  cues: CommentarySpeechCue[],
): CueScript[] {
  const byId = new Map(scripts.map((script) => [script.cueId, script]));
  return cues.map((cue) => {
    const match = byId.get(cue.cueId);
    if (match) return match;
    return {
      cueId: cue.cueId,
      scriptIt: cue.summary,
      scriptEn: cue.summary,
    };
  });
}

export function createGenerateCuedRaceScripts(
  deps: Dependencies,
): GenerateCuedRaceScripts {
  const log = deps.logger.child({ operation: "generateCuedRaceScripts" });

  return async ({ analysis, cues, voiceOverMode }) => {
    if (voiceOverMode !== "commentator") {
      throw new Error("Cued race scripts require commentator voiceOverMode");
    }
    const startedAt = performance.now();
    log.info("Cued race scripts started", { cueCount: cues.length });

    const response = await deps.llm.complete({
      system: CUED_SYSTEM_PROMPT,
      user: JSON.stringify(
        {
          raceContext: JSON.parse(analysisContextForEditorial(analysis)),
          instruction:
            "One punchy play-by-play line per speechCue, synced to targetMs on video.",
          speechCues: cuePayload(cues),
        },
        null,
        2,
      ),
      jsonSchema: responseJsonSchema,
    });

    const parsed = alignCueScripts(
      cuedScriptsSchema.parse(JSON.parse(response)).cues,
      cues,
    );

    log.info("Cued race scripts completed", {
      cueCount: parsed.length,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return parsed;
  };
}
