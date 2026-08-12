import path from "node:path";

import { z } from "zod";

import type { ReplaySession } from "@/src/domain/entities";
import {
  BRAND_TTS_INSTRUCTIONS,
  buildSrt,
  chunkNarration,
  hashVoiceScript,
  offsetWords,
  type TimedWord,
  type VoiceOverLanguage,
  type VoiceOverPackage,
} from "@/src/domain/voice-over";
import type { ClockPort } from "@/src/ports/clock";
import type { AudioConcatPort } from "@/src/ports/full-vo-mix";
import type { LlmPort } from "@/src/ports/llm";
import type { Logger } from "@/src/ports/logger";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";
import type { SettingsRepository } from "@/src/ports/settings-repository";
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

const SYSTEM_PROMPT = `Write a chaptered voice-over narration for a full simracing race upload.
Follow the supplied race timeline: one chapter per timeline beat, in chronological order, dense but catchy.
Generate Italian first, then create an English adaptation (not a literal translation) that keeps the same energy.
Place a call to action to subscribe mid-narration and again at the end.
The focus car is the white/black/green π car from S.Marcato 42 Racing. Never invent race facts absent from the supplied race package.
Return the chapter list plus localized titles and descriptions for the two uploads.`;

/** Provider-friendly TTS budget; the spec allows roughly 500–800 words per call. */
const MAX_WORDS_PER_TTS_CALL = 700;

const LANGUAGES: VoiceOverLanguage[] = ["it", "en"];

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
};

export type GenerateFullVoiceOvers = (input: {
  sessionId: string;
}) => Promise<VoiceOverPackage[]>;

type LanguageScript = {
  language: VoiceOverLanguage;
  segments: string[];
  script: string;
  title: string;
  description: string;
};

function raceContext(session: ReplaySession): string {
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
): LanguageScript[] {
  const italian = scripts.chapters.map((chapter) => chapter.scriptIt.trim());
  const english = scripts.chapters.map((chapter) => chapter.scriptEn.trim());
  return [
    {
      language: "it",
      segments: italian,
      script: italian.join("\n\n"),
      title: scripts.titleIt,
      description: scripts.descriptionIt,
    },
    {
      language: "en",
      segments: english,
      script: english.join("\n\n"),
      title: scripts.titleEn,
      description: scripts.descriptionEn,
    },
  ];
}

export function createGenerateFullVoiceOvers(
  deps: Dependencies,
): GenerateFullVoiceOvers {
  const log = deps.logger.child({ operation: "generateFullVoiceOvers" });

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
  }): Promise<{ words: TimedWord[]; durationMs: number }> {
    const startedAt = performance.now();
    const synthesis = await deps.tts.synthesize({
      text: input.text,
      voiceProfile: input.voiceProfile,
      outputPath: input.outputPath,
      instructions: BRAND_TTS_INSTRUCTIONS,
    });
    if (synthesis.durationMs <= 0) {
      throw new Error(
        `Voice-over chunk ${input.index + 1}/${input.total} for ${input.language} produced no audio`,
      );
    }
    const transcription = await deps.transcription.transcribe(
      input.outputPath,
      { words: true },
    );
    const words = transcription.words ?? [];
    if (words.length === 0) {
      throw new Error(
        `Voice-over alignment for ${input.language} chunk ${input.index + 1}/${input.total} returned no word timestamps`,
      );
    }
    log.info("Full voice-over chunk completed", {
      sessionId: input.sessionId,
      language: input.language,
      chunk: `${input.index + 1}/${input.total}`,
      audioDurationMs: synthesis.durationMs,
      wordCount: words.length,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return {
      words: offsetWords(words, input.offsetMs),
      durationMs: synthesis.durationMs,
    };
  }

  async function buildPackage(input: {
    sessionId: string;
    languageScript: LanguageScript;
    voiceProfile: string;
    scriptHash: string;
    voPath: (sessionId: string, language: VoiceOverLanguage) => string;
    writeText: (filePath: string, content: string) => Promise<void>;
  }): Promise<VoiceOverPackage> {
    const { language, script, title, description } = input.languageScript;
    const audioPath = input.voPath(input.sessionId, language);
    const chunks = chunkNarration(
      input.languageScript.segments,
      MAX_WORDS_PER_TTS_CALL,
    );
    if (chunks.length === 0) {
      throw new Error(`Voice-over script for ${language} is empty`);
    }
    log.info("Full voice-over synthesis started", {
      sessionId: input.sessionId,
      language,
      chunkCount: chunks.length,
    });

    const chunkPaths: string[] = [];
    const words: TimedWord[] = [];
    let offsetMs = 0;
    // Sequential on purpose: chunk N's words are placed after chunk N-1's
    // synthesized audio, and TTS providers rate-limit parallel calls.
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
      });
      chunkPaths.push(outputPath);
      words.push(...chunk.words);
      offsetMs += chunk.durationMs;
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
      chunkCount: chunks.length,
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

  return async ({ sessionId }) => {
    const startedAt = performance.now();
    log.info("Full voice-over generation started", { sessionId });
    try {
      const [session, appSettings] = await Promise.all([
        deps.replaySessions.getById(sessionId),
        deps.settings.get(),
      ]);
      if (!session) {
        throw new Error(`Replay session not found: ${sessionId}`);
      }
      if (!appSettings.enableVoiceOverPipeline) {
        throw new Error("Voice-over pipeline is disabled in settings");
      }
      if (!session.racePackage?.fullVideo?.title) {
        throw new Error(
          "Run AV analysis first so the racePackage timeline and metadata exist",
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
      const response = await deps.llm.complete({
        system: SYSTEM_PROMPT,
        user: `Write the bilingual full-race narration for this race package:\n${raceContext(session)}`,
        jsonSchema: responseJsonSchema,
      });
      const scripts = scriptsSchema.parse(JSON.parse(response));
      log.info("Full voice-over scripts generated", {
        sessionId,
        chapterCount: scripts.chapters.length,
        durationMs: Math.round(performance.now() - scriptStartedAt),
      });

      const existingByLanguage = new Map(
        (session.fullVoiceOvers ?? []).map((item) => [item.language, item]),
      );
      const packages: VoiceOverPackage[] = [];
      let reusedCount = 0;

      for (const languageScript of languageScripts(scripts)) {
        const languageStartedAt = performance.now();
        const scriptHash = hashVoiceScript(
          languageScript.script,
          appSettings.brandVoiceProfile,
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

        packages.push(
          await buildPackage({
            sessionId,
            languageScript,
            voiceProfile: appSettings.brandVoiceProfile,
            scriptHash,
            voPath,
            writeText,
          }),
        );
        log.info("Full voice-over language completed", {
          sessionId,
          language: languageScript.language,
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
