import { z } from "zod";

import {
  RACE_METADATA_STYLE,
  RACE_VOICE_OVER_STYLE,
} from "@/src/domain/race-copy-style";
import {
  SPORTS_COMMENTARY_STYLE,
  type VoiceOverMode,
} from "@/src/domain/commentary-style";
import {
  type CommentaryTimelineChapter,
  targetWordsForChapter,
} from "@/src/domain/commentary-timeline-segments";
import { analysisContextForEditorial } from "@/src/domain/editorial";
import type { RaceAnalysis } from "@/src/domain/race-analysis";
import type { LlmPort } from "@/src/ports/llm";
import type { Logger } from "@/src/ports/logger";

const chapterScriptSchema = z.object({
  label: z.string().trim().min(1),
  scriptIt: z.string().trim().min(1),
  scriptEn: z.string().trim().min(1),
});

const chapterScriptsSchema = z.object({
  chapters: z.array(chapterScriptSchema).min(1),
});

type ChapterScript = z.infer<typeof chapterScriptSchema>;

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["chapters"],
  properties: {
    chapters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "scriptIt", "scriptEn"],
        properties: {
          label: { type: "string" },
          scriptIt: { type: "string" },
          scriptEn: { type: "string" },
        },
      },
    },
  },
} satisfies Record<string, unknown>;

const CONTINUITY_RULES = `
Continuity across the full race (mandatory):
- Treat all chapters as ONE live broadcast split only for timeline alignment.
- Chapter N+1 must flow naturally from chapter N: no repeated intros ("Benvenuti", "Siamo a…") after the first segment.
- Carry forward position, gaps, rivals, and incidents already stated; do not contradict earlier facts.
- Brief callbacks are good ("dopo quella rimonta…", "as we saw earlier…") but avoid re-explaining the whole race each segment.
- End mid-thought or on tension when the next segment continues the same battle; do not wrap up the entire race until the final chapter.
- Keep each chapter within its targetWordsMin–targetWordsMax; trim repetition instead of adding filler.
`.trim();

function systemPromptForMode(mode: VoiceOverMode): string {
  const spokenStyle =
    mode === "commentator" ? SPORTS_COMMENTARY_STYLE : RACE_VOICE_OVER_STYLE;
  return `${spokenStyle}

Write bilingual spoken scripts for a full simracing race upload, one chapter per supplied timeline segment.
Follow the race timeline strictly: one output chapter per input chapter, same order and labels.
Italian script first; English is an adaptation (same facts and energy, not a calque).
Spoken text only — no timestamps, rig specs, or hashtags (${RACE_METADATA_STYLE} applies to titles/descriptions elsewhere).
Each chapter must respect targetWordsMin–targetWordsMax so total commentary spans the race.

${CONTINUITY_RULES}`;
}

const REVISION_SYSTEM_PROMPT = `You are a senior motorsport script editor.
Revise a draft chaptered race commentary for smooth continuity across the full upload.
Keep the same chapter count, labels, and order. Preserve facts from raceContext; do not invent events.
Improve transitions between chapters, remove repetition, and align EN with IT energy.
${CONTINUITY_RULES}`;

function chapterSpecs(
  timelineChapters: CommentaryTimelineChapter[],
): Record<string, unknown>[] {
  return timelineChapters.map((chapter) => ({
    label: chapter.label,
    startMs: chapter.startMs,
    endMs: chapter.endMs,
    durationSec: Math.round((chapter.endMs - chapter.startMs) / 1_000),
    summaries: chapter.summaries,
    events: chapter.events.slice(0, 10),
    targetWords: targetWordsForChapter(chapter),
    targetWordsMin: chapter.targetWordsMin,
    targetWordsMax: chapter.targetWordsMax,
  }));
}

function totalWordsIt(chapters: ChapterScript[]): number {
  return chapters.reduce(
    (sum, chapter) => sum + chapter.scriptIt.split(/\s+/).length,
    0,
  );
}

/** Restore timeline labels when the model drifts on chapter labels. */
export function alignChapterLabels(
  draft: ChapterScript[],
  timelineChapters: CommentaryTimelineChapter[],
): ChapterScript[] {
  return draft.map((chapter, index) => ({
    ...chapter,
    label: timelineChapters[index]?.label ?? chapter.label,
  }));
}

type Dependencies = {
  llm: LlmPort;
  logger: Logger;
};

export type GenerateChapteredRaceScripts = (input: {
  analysis: RaceAnalysis;
  chapters: CommentaryTimelineChapter[];
  voiceOverMode: VoiceOverMode;
}) => Promise<ChapterScript[]>;

export function createGenerateChapteredRaceScripts(
  deps: Dependencies,
): GenerateChapteredRaceScripts {
  const log = deps.logger.child({ operation: "generateChapteredRaceScripts" });

  return async ({ analysis, chapters, voiceOverMode }) => {
    const startedAt = performance.now();
    log.info("Chaptered race scripts started", {
      chapterCount: chapters.length,
      voiceOverMode,
      durationSec: analysis.context.durationSec,
    });

    const raceContext = JSON.parse(analysisContextForEditorial(analysis));

    const draftResponse = await deps.llm.complete({
      system: systemPromptForMode(voiceOverMode),
      user: JSON.stringify(
        {
          raceContext,
          chapters: chapterSpecs(chapters),
        },
        null,
        2,
      ),
      jsonSchema: responseJsonSchema,
    });

    const draft = alignChapterLabels(
      chapterScriptsSchema.parse(JSON.parse(draftResponse)).chapters,
      chapters,
    );

    if (draft.length !== chapters.length) {
      log.warn("Draft chapter count mismatch; skipping continuity revision", {
        expected: chapters.length,
        received: draft.length,
      });
      log.info("Chaptered race scripts completed", {
        chapterCount: draft.length,
        totalWordsIt: totalWordsIt(draft),
        durationMs: Math.round(performance.now() - startedAt),
      });
      return draft;
    }

    const reviseStartedAt = performance.now();
    log.info("Chaptered race scripts continuity revision started", {
      chapterCount: draft.length,
      draftWordsIt: totalWordsIt(draft),
    });

    const revisedResponse = await deps.llm.complete({
      system: REVISION_SYSTEM_PROMPT,
      user: JSON.stringify(
        {
          raceContext,
          chapterTargets: chapterSpecs(chapters),
          draftChapters: draft,
        },
        null,
        2,
      ),
      jsonSchema: responseJsonSchema,
    });

    const revised = alignChapterLabels(
      chapterScriptsSchema.parse(JSON.parse(revisedResponse)).chapters,
      chapters,
    );

    if (revised.length !== chapters.length) {
      log.warn("Revised chapter count mismatch; keeping draft", {
        expected: chapters.length,
        received: revised.length,
      });
      return draft;
    }

    log.info("Chaptered race scripts completed", {
      chapterCount: revised.length,
      draftWordsIt: totalWordsIt(draft),
      revisedWordsIt: totalWordsIt(revised),
      revisionDurationMs: Math.round(performance.now() - reviseStartedAt),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return revised;
  };
}
