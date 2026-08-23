import path from "node:path";

import { z } from "zod";

import type { ReplaySession } from "@/src/domain/entities";
import type { EditorialLocalize } from "@/src/application/editorial-localize";
import type { GenerateChapteredRaceScripts } from "@/src/application/generate-chaptered-race-scripts";
import {
  buildCommentaryChaptersFromTimeline,
  shouldUseTimelineChapteredScripts,
  type CommentaryTimelineChapter,
} from "@/src/domain/commentary-timeline-segments";
import {
  RACE_METADATA_STYLE,
  RACE_VOICE_OVER_STYLE,
} from "@/src/domain/race-copy-style";
import {
  commentaryIntensityForText,
  SPORTS_COMMENTARY_STYLE,
  ttsInstructionsForCommentary,
  type VoiceOverMode,
  voiceProfileForMode,
} from "@/src/domain/commentary-style";
import {
  buildSrt,
  chunkNarration,
  hashVoiceScript,
  offsetWords,
  TTS_CHUNK_LIMITS,
  ttsInstructionsFor,
  type TimedWord,
  type VoiceOverLanguage,
  type VoiceOverPackage,
} from "@/src/domain/voice-over";
import type { ClockPort } from "@/src/ports/clock";
import type { AudioConcatPort } from "@/src/ports/full-vo-mix";
import type { LlmPort } from "@/src/ports/llm";
import type { Logger } from "@/src/ports/logger";
import type { MediaDurationPort } from "@/src/ports/media-duration";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";
import type {
  AppSettings,
  SettingsRepository,
} from "@/src/ports/settings-repository";
import type { TranscriptionPort } from "@/src/ports/transcription";
import type { TtsPort } from "@/src/ports/tts";

const scriptsSchema = z.object({
  chapters: z
    .array(
      z.object({
        label: z.string().trim().min(1),
        scriptIt: z.string().trim().min(1),
        scriptEn: z.string().trim().min(1),
      }),
    )
    .min(1),
  titleIt: z.string().trim().min(1),
  titleEn: z.string().trim().min(1),
  descriptionIt: z.string().trim().min(1),
  descriptionEn: z.string().trim().min(1),
});

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "chapters",
    "titleIt",
    "titleEn",
    "descriptionIt",
    "descriptionEn",
  ],
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
    titleIt: { type: "string" },
    titleEn: { type: "string" },
    descriptionIt: { type: "string" },
    descriptionEn: { type: "string" },
  },
} satisfies Record<string, unknown>;

const SYSTEM_PROMPT_DRIVER = `${RACE_VOICE_OVER_STYLE}

Write a chaptered spoken narration for a full simracing race upload.
Follow the supplied race timeline: one chapter per timeline beat, chronological, dense but concrete.
Also return localized titles and YouTube descriptions for the two uploads (${RACE_METADATA_STYLE}).
Spoken chapters = race story only; put CTA mid + end in the spoken text.
Written description may add chapters/timestamps, rig block, and hashtags after the race story.`;

const SYSTEM_PROMPT_COMMENTATOR = `${SPORTS_COMMENTARY_STYLE}

Write chaptered third-person live sports commentary for a full simracing race upload.
Follow the supplied race timeline: one chapter per timeline beat, chronological, dense but concrete.
Also return localized titles and YouTube descriptions for the two uploads (${RACE_METADATA_STYLE}).
Spoken chapters = commentary only; put CTA mid + end in the spoken text.
Written description may add chapters/timestamps, rig block, and hashtags after the race story.`;

function systemPromptForMode(mode: VoiceOverMode): string {
  return mode === "commentator"
    ? SYSTEM_PROMPT_COMMENTATOR
    : SYSTEM_PROMPT_DRIVER;
}

type Dependencies = {
  llm: LlmPort;
  tts: TtsPort;
  transcription: TranscriptionPort;
  audioConcat: AudioConcatPort;
  mediaStore: MediaStorePort;
  replaySessions: ReplaySessionRepository;
  settings: SettingsRepository;
  clock: ClockPort;
  logger: Logger;
  /** Measures rendered chunk audio so word offsets match the concatenated file. */
  mediaDuration?: MediaDurationPort;
  /** Preferred when session.raceAnalysis is present (single-master editorial). */
  editorialLocalize?: EditorialLocalize;
  generateChapteredRaceScripts?: GenerateChapteredRaceScripts;
};

export type GenerateFullVoiceOvers = (input: {
  sessionId: string;
  /** Rebuilds already-published languages whose script drifted. */
  regenerate?: boolean;
  /** Overrides settings.voiceOverMode for this generation run. */
  voiceOverMode?: VoiceOverMode;
}) => Promise<VoiceOverPackage[]>;

type LanguageScript = {
  language: VoiceOverLanguage;
  segments: string[];
  script: string;
  title: string;
  description: string;
  chapterTimings?: Array<{ startMs: number; endMs: number }>;
};

function raceContext(session: ReplaySession): string {
  if (session.raceAnalysis) {
    const hud = session.raceAnalysis.hudTimeline ?? [];
    return JSON.stringify({
      title: session.title,
      trackName: session.trackName,
      durationSec: session.durationSec,
      raceAnalysis: {
        context: session.raceAnalysis.context,
        results: session.raceAnalysis.results,
        mainStoryline: session.raceAnalysis.mainStoryline,
        whyWatch: session.raceAnalysis.whyWatch,
        storylines: session.raceAnalysis.storylines,
        timeline: session.raceAnalysis.timeline,
        narrativeIt: session.raceAnalysis.narrativeIt,
        events: session.raceAnalysis.events,
        potentialHooks: session.raceAnalysis.potentialHooks,
        recurringRivals: session.raceAnalysis.recurringRivals,
        focusCarHint: session.raceAnalysis.focusCarHint,
        hudSummary: {
          snapshotCount: hud.length,
          first: hud[0]
            ? {
                timeMs: hud[0].timeMs,
                focus: hud[0].focus,
                session: hud[0].session,
              }
            : null,
          last: hud.length
            ? {
                timeMs: hud[hud.length - 1]!.timeMs,
                focus: hud[hud.length - 1]!.focus,
                session: hud[hud.length - 1]!.session,
              }
            : null,
        },
      },
    });
  }
  return JSON.stringify({
    title: session.title,
    trackName: session.trackName,
    durationSec: session.durationSec,
    focusCarHint: session.racePackage?.focusCarHint,
    transcript: session.racePackage?.transcript,
    timeline: session.racePackage?.timeline,
    fullVideo: session.racePackage?.fullVideo,
  });
}

function chunkPath(audioPath: string, index: number): string {
  const parsed = path.parse(audioPath);
  return path.join(parsed.dir, `${parsed.name}-part-${index + 1}${parsed.ext}`);
}

function srtPathFor(audioPath: string): string {
  const parsed = path.parse(audioPath);
  return path.join(parsed.dir, `${parsed.name}.srt`);
}

function languageScripts(
  scripts: z.infer<typeof scriptsSchema>,
  chapterPlans?: CommentaryTimelineChapter[],
): LanguageScript[] {
  const italian = scripts.chapters.map((chapter) => chapter.scriptIt.trim());
  const english = scripts.chapters.map((chapter) => chapter.scriptEn.trim());
  const chapterTimings = chapterPlans?.map((chapter) => ({
    startMs: chapter.startMs,
    endMs: chapter.endMs,
  }));
  return [
    {
      language: "it",
      segments: italian,
      script: italian.join("\n\n"),
      title: scripts.titleIt,
      description: scripts.descriptionIt,
      chapterTimings,
    },
    {
      language: "en",
      segments: english,
      script: english.join("\n\n"),
      title: scripts.titleEn,
      description: scripts.descriptionEn,
      chapterTimings,
    },
  ];
}

export function createGenerateFullVoiceOvers(
  deps: Dependencies,
): GenerateFullVoiceOvers {
  const log = deps.logger.child({ operation: "generateFullVoiceOvers" });

  /**
   * Rendered length of a synthesized chunk. TTS adapters may only return an
   * estimate (words × constant), which drifts by seconds over a full race, so
   * the probed file wins and the aligner's last word end is the fallback.
   */
  async function measureChunkMs(
    audioPath: string,
    words: TimedWord[],
    context: Record<string, unknown>,
  ): Promise<{ durationMs: number; source: "probe" | "alignment" }> {
    if (deps.mediaDuration) {
      try {
        const seconds = await deps.mediaDuration.probeDurationSec(audioPath);
        if (seconds !== null && Number.isFinite(seconds) && seconds > 0) {
          return { durationMs: Math.round(seconds * 1_000), source: "probe" };
        }
        log.warn("Voice-over chunk duration probe returned no usable value", {
          ...context,
          audioPath,
        });
      } catch (error) {
        log.warn("Voice-over chunk duration probe failed", {
          ...context,
          audioPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      durationMs: words[words.length - 1]!.endMs,
      source: "alignment",
    };
  }

  /** Synthesizes one chunk and returns its words on the concatenated timeline. */
  async function synthesizeChunk(input: {
    sessionId: string;
    language: VoiceOverLanguage;
    text: string;
    outputPath: string;
    offsetMs: number;
    index: number;
    total: number;
    voiceProfile: string;
    voiceOverMode: VoiceOverMode;
  }): Promise<{ words: TimedWord[]; durationMs: number }> {
    const startedAt = performance.now();
    const chunkLabel = `${input.index + 1}/${input.total}`;
    const instructions =
      input.voiceOverMode === "commentator"
        ? ttsInstructionsForCommentary(
            input.language,
            commentaryIntensityForText(input.text),
          )
        : ttsInstructionsFor(input.language);
    await deps.tts.synthesize({
      text: input.text,
      voiceProfile: input.voiceProfile,
      outputPath: input.outputPath,
      instructions,
    });
    const transcription = await deps.transcription.transcribe(
      input.outputPath,
      { words: true },
    );
    const words = transcription.words ?? [];
    if (words.length === 0) {
      throw new Error(
        `Voice-over alignment for ${input.language} chunk ${chunkLabel} returned no word timestamps`,
      );
    }
    const measured = await measureChunkMs(input.outputPath, words, {
      sessionId: input.sessionId,
      language: input.language,
      chunk: chunkLabel,
    });
    if (measured.durationMs <= 0) {
      throw new Error(
        `Voice-over chunk ${chunkLabel} for ${input.language} produced no audio`,
      );
    }
    log.info("Full voice-over chunk completed", {
      sessionId: input.sessionId,
      language: input.language,
      chunk: chunkLabel,
      audioDurationMs: measured.durationMs,
      durationSource: measured.source,
      wordCount: words.length,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return {
      words: offsetWords(words, input.offsetMs),
      durationMs: measured.durationMs,
    };
  }

  async function buildPackage(input: {
    sessionId: string;
    languageScript: LanguageScript;
    voiceProfile: string;
    scriptHash: string;
    voiceOverMode: VoiceOverMode;
    voPath: (sessionId: string, language: VoiceOverLanguage) => string;
    writeText: (filePath: string, content: string) => Promise<void>;
  }): Promise<VoiceOverPackage> {
    const { language, script, title, description, chapterTimings } =
      input.languageScript;
    const audioPath = input.voPath(input.sessionId, language);
    const useTimelineChapters =
      chapterTimings &&
      chapterTimings.length === input.languageScript.segments.length &&
      chapterTimings.length > 1;

    const chunkPaths: string[] = [];
    const words: TimedWord[] = [];
    let offsetMs = 0;
    let ttsChunkTotal = 0;

    if (useTimelineChapters) {
      log.info("Full voice-over timeline chapter synthesis started", {
        sessionId: input.sessionId,
        language,
        chapterCount: input.languageScript.segments.length,
      });
      for (const [chapterIndex, segment] of input.languageScript.segments.entries()) {
        const timing = chapterTimings![chapterIndex]!;
        const silenceMs = Math.max(0, timing.startMs - offsetMs);
        if (silenceMs >= 50 && deps.audioConcat.generateSilence) {
          const silencePath = path.join(
            path.dirname(audioPath),
            `${path.parse(audioPath).name}-silence-${chapterIndex}.mp3`,
          );
          await deps.audioConcat.generateSilence({
            durationMs: silenceMs,
            outputPath: silencePath,
          });
          chunkPaths.push(silencePath);
          offsetMs += silenceMs;
        }
        const chapterChunks = chunkNarration([segment], TTS_CHUNK_LIMITS);
        for (const text of chapterChunks) {
          ttsChunkTotal += 1;
          const outputPath = chunkPath(audioPath, chunkPaths.length);
          const chunk = await synthesizeChunk({
            sessionId: input.sessionId,
            language,
            text,
            outputPath,
            offsetMs,
            index: chunkPaths.length,
            total: chapterChunks.length,
            voiceProfile: input.voiceProfile,
            voiceOverMode: input.voiceOverMode,
          });
          chunkPaths.push(outputPath);
          words.push(...chunk.words);
          offsetMs += chunk.durationMs;
        }
      }
    } else {
      const chunks = chunkNarration(
        input.languageScript.segments,
        TTS_CHUNK_LIMITS,
      );
      if (chunks.length === 0) {
        throw new Error(`Voice-over script for ${language} is empty`);
      }
      log.info("Full voice-over synthesis started", {
        sessionId: input.sessionId,
        language,
        chunkCount: chunks.length,
        maxChunkChars: Math.max(...chunks.map((chunk) => chunk.length)),
      });
      ttsChunkTotal = chunks.length;
      for (const [index, text] of chunks.entries()) {
        const outputPath = chunkPath(audioPath, index);
        const chunk = await synthesizeChunk({
          sessionId: input.sessionId,
          language,
          text,
          outputPath,
          offsetMs,
          index,
          total: chunks.length,
          voiceProfile: input.voiceProfile,
          voiceOverMode: input.voiceOverMode,
        });
        chunkPaths.push(outputPath);
        words.push(...chunk.words);
        offsetMs += chunk.durationMs;
      }
    }

    if (chunkPaths.length === 0) {
      throw new Error(`Voice-over script for ${language} is empty`);
    }

    const concatenated = await deps.audioConcat.concat({
      inputPaths: chunkPaths,
      outputPath: audioPath,
    });
    const srtPath = srtPathFor(concatenated.outputPath);
    await input.writeText(srtPath, buildSrt(words));

    log.info("Full voice-over package built", {
      sessionId: input.sessionId,
      language,
      chunkCount: ttsChunkTotal,
      timelineChapters: useTimelineChapters
        ? input.languageScript.segments.length
        : 0,
      wordCount: words.length,
      audioDurationMs: offsetMs,
      audioPath: concatenated.outputPath,
    });
    return {
      language,
      script,
      title,
      description,
      voiceProfile: input.voiceProfile,
      audioPath: concatenated.outputPath,
      words,
      srtPath,
      // Full uploads rely on soft captions; burn-in reads the same SRT.
      assPath: null,
      scriptHash: input.scriptHash,
    };
  }

  return async ({ sessionId, regenerate = false, voiceOverMode: modeOverride }) => {
    const startedAt = performance.now();
    log.info("Full voice-over generation started", { sessionId, regenerate });
    try {
      const [session, appSettings] = await Promise.all([
        deps.replaySessions.getById(sessionId),
        deps.settings.get(),
      ]);
      const voiceOverMode = modeOverride ?? appSettings.voiceOverMode;
      if (!session) {
        throw new Error(`Replay session not found: ${sessionId}`);
      }
      if (!appSettings.enableVoiceOverPipeline) {
        throw new Error("Voice-over pipeline is disabled in settings");
      }
      if (!session.racePackage?.fullVideo?.title && !session.raceAnalysis) {
        throw new Error(
          "Run AV analysis first so the race analysis / racePackage exists",
        );
      }
      const voPath = deps.mediaStore.fullReplayVoPath?.bind(deps.mediaStore);
      const writeText = deps.mediaStore.writeText?.bind(deps.mediaStore);
      if (!voPath || !writeText) {
        throw new Error(
          "Media store does not support full-race voice-over artifacts",
        );
      }
      await deps.mediaStore.ensureDirs();

      const scriptStartedAt = performance.now();
      let scripts: z.infer<typeof scriptsSchema>;
      let chapterPlans: CommentaryTimelineChapter[] | undefined;
      const analysis = session.raceAnalysis;
      const useChaptered =
        analysis &&
        shouldUseTimelineChapteredScripts(analysis, voiceOverMode) &&
        deps.generateChapteredRaceScripts;

      if (useChaptered && analysis) {
        chapterPlans = buildCommentaryChaptersFromTimeline(analysis);
        let titleIt: string;
        let titleEn: string;
        let descriptionIt: string;
        let descriptionEn: string;
        if (deps.editorialLocalize) {
          const editorial = await deps.editorialLocalize({
            analysis,
            voiceOverMode,
          });
          titleIt = editorial.it.title;
          titleEn = editorial.en.title;
          descriptionIt = editorial.it.description;
          descriptionEn = editorial.en.description;
        } else {
          titleIt = session.title;
          titleEn = session.title;
          descriptionIt = analysis.mainStoryline;
          descriptionEn = analysis.mainStoryline;
        }
        const chapterScripts = await deps.generateChapteredRaceScripts!({
          analysis,
          chapters: chapterPlans,
          voiceOverMode,
        });
        scripts = {
          chapters: chapterScripts,
          titleIt,
          titleEn,
          descriptionIt,
          descriptionEn,
        };
        log.info("Full voice-over scripts from timeline chapters", {
          sessionId,
          chapterCount: chapterScripts.length,
          voiceOverMode,
          durationMs: Math.round(performance.now() - scriptStartedAt),
        });
      } else if (analysis && deps.editorialLocalize) {
        const editorial = await deps.editorialLocalize({
          analysis,
          voiceOverMode,
        });
        scripts = {
          chapters: [
            {
              label: "race",
              scriptIt: editorial.it.voiceOverScript,
              scriptEn: editorial.en.voiceOverScript,
            },
          ],
          titleIt: editorial.it.title,
          titleEn: editorial.en.title,
          descriptionIt: editorial.it.description,
          descriptionEn: editorial.en.description,
        };
        log.info("Full voice-over scripts from editorial localize", {
          sessionId,
          titleIt: editorial.it.title,
          durationMs: Math.round(performance.now() - scriptStartedAt),
        });
      } else {
        const response = await deps.llm.complete({
          system: systemPromptForMode(voiceOverMode),
          user: `Write the bilingual full-race narration for this race package:\n${raceContext(session)}`,
          jsonSchema: responseJsonSchema,
        });
        scripts = scriptsSchema.parse(JSON.parse(response));
        log.info("Full voice-over scripts generated", {
          sessionId,
          chapterCount: scripts.chapters.length,
          durationMs: Math.round(performance.now() - scriptStartedAt),
        });
      }
      const existingByLanguage = new Map(
        (session.fullVoiceOvers ?? []).map((item) => [item.language, item]),
      );
      const packages: VoiceOverPackage[] = [];
      let reusedCount = 0;

      for (const languageScript of languageScripts(scripts, chapterPlans)) {
        const languageStartedAt = performance.now();
        const voiceProfile = voiceProfileForMode(
          appSettings,
          languageScript.language,
          voiceOverMode,
        );
        const scriptHash = hashVoiceScript(
          languageScript.script,
          voiceProfile,
          languageScript.language,
        );
        const cached = existingByLanguage.get(languageScript.language);
        if (cached?.scriptHash === scriptHash) {
          packages.push({
            ...cached,
            title: languageScript.title,
            description: languageScript.description,
          });
          reusedCount += 1;
          log.info("Full voice-over package reused", {
            sessionId,
            language: languageScript.language,
            durationMs: Math.round(performance.now() - languageStartedAt),
          });
          continue;
        }
        // A fresh LLM pass produces a new script hash on every run. Replacing a
        // package that already carries a YouTube id would drop that id and
        // publish the same race twice, so drift only rebuilds on request.
        if (cached?.youtubeVideoId && !regenerate) {
          packages.push(cached);
          reusedCount += 1;
          log.warn("Full voice-over script drifted after publishing; keeping published package", {
            sessionId,
            language: languageScript.language,
            youtubeVideoId: cached.youtubeVideoId,
            publishedScriptHash: cached.scriptHash,
            candidateScriptHash: scriptHash,
          });
          continue;
        }

        packages.push(
          await buildPackage({
            sessionId,
            languageScript,
            voiceProfile,
            scriptHash,
            voiceOverMode,
            voPath,
            writeText,
          }),
        );
        log.info("Full voice-over language completed", {
          sessionId,
          language: languageScript.language,
          voiceOverMode,
          durationMs: Math.round(performance.now() - languageStartedAt),
        });
      }

      const fresh = await deps.replaySessions.getById(sessionId);
      if (!fresh) {
        throw new Error(
          `Replay session not found before voice-over save: ${sessionId}`,
        );
      }
      await deps.replaySessions.save({
        ...fresh,
        fullVoiceOvers: packages,
        updatedAt: deps.clock.now(),
      });
      log.info("Full voice-over generation completed", {
        sessionId,
        packageCount: packages.length,
        reusedCount,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return packages;
    } catch (error) {
      log.error("Full voice-over generation failed", {
        sessionId,
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error),
        durationMs: Math.round(performance.now() - startedAt),
      });
      throw error;
    }
  };
}
