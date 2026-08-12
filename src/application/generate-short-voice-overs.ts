import path from "node:path";

import { z } from "zod";

import type { ShortCandidate } from "@/src/domain/entities";
import {
  BRAND_TTS_INSTRUCTIONS,
  buildAssKaraoke,
  buildSrt,
  hashVoiceScript,
  type VoiceOverLanguage,
  type VoiceOverPackage,
} from "@/src/domain/voice-over";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { LlmPort } from "@/src/ports/llm";
import type { Logger } from "@/src/ports/logger";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { SettingsRepository } from "@/src/ports/settings-repository";
import type { TranscriptionPort } from "@/src/ports/transcription";
import type { TtsPort } from "@/src/ports/tts";

const scriptsSchema = z.object({
  scriptIt: z.string().trim().min(1),
  scriptEn: z.string().trim().min(1),
  titleIt: z.string().trim().min(1),
  titleEn: z.string().trim().min(1),
  descriptionIt: z.string().trim().min(1),
  descriptionEn: z.string().trim().min(1),
});

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "scriptIt",
    "scriptEn",
    "titleIt",
    "titleEn",
    "descriptionIt",
    "descriptionEn",
  ],
  properties: {
    scriptIt: { type: "string" },
    scriptEn: { type: "string" },
    titleIt: { type: "string" },
    titleEn: { type: "string" },
    descriptionIt: { type: "string" },
    descriptionEn: { type: "string" },
  },
} satisfies Record<string, unknown>;

const SYSTEM_PROMPT = `Write an energetic YouTube Short voice-over lasting 8–25 spoken seconds.
Generate Italian first, then create an English adaptation (not a literal translation).
Both versions must hook viewers in the first 2 seconds, name the racing moment, and end with a clear CTA to subscribe or watch the full race.
The focus car is the white/black/green π car from S.Marcato 42 Racing. Never invent race results or facts absent from the supplied candidate.
Return both language scripts plus concise localized titles and descriptions.`;

type Dependencies = {
  llm: LlmPort;
  tts: TtsPort;
  transcription: TranscriptionPort;
  mediaStore: MediaStorePort;
  candidates: CandidateRepository;
  settings: SettingsRepository;
  logger: Logger;
};

export type GenerateShortVoiceOvers = (input: {
  candidateId: string;
}) => Promise<VoiceOverPackage[]>;

function candidateContext(candidate: ShortCandidate): string {
  return JSON.stringify({
    id: candidate.id,
    origin: candidate.origin,
    title: candidate.title,
    description: candidate.description,
    tags: candidate.tags,
    provenance: candidate.provenance,
  });
}

function captionPath(audioPath: string, extension: ".srt" | ".ass"): string {
  const parsed = path.parse(audioPath);
  return path.join(parsed.dir, `${parsed.name}${extension}`);
}

export function createGenerateShortVoiceOvers(
  deps: Dependencies,
): GenerateShortVoiceOvers {
  const log = deps.logger.child({ operation: "generateShortVoiceOvers" });

  return async ({ candidateId }) => {
    const startedAt = performance.now();
    log.info("Short voice-over generation started", { candidateId });
    try {
      const [candidate, appSettings] = await Promise.all([
        deps.candidates.getById(candidateId),
        deps.settings.get(),
      ]);
      if (!candidate) {
        throw new Error(`Short candidate not found: ${candidateId}`);
      }
      if (!appSettings.enableVoiceOverPipeline) {
        throw new Error("Voice-over pipeline is disabled in settings");
      }
      const voPath = deps.mediaStore.voPath?.bind(deps.mediaStore);
      const writeText = deps.mediaStore.writeText?.bind(deps.mediaStore);
      if (!voPath || !writeText) {
        throw new Error("Media store does not support voice-over artifacts");
      }

      await deps.mediaStore.ensureDirs();
      const scriptStartedAt = performance.now();
      const response = await deps.llm.complete({
        system: SYSTEM_PROMPT,
        user: `Create bilingual voice-over copy for this candidate:\n${candidateContext(candidate)}`,
        jsonSchema: responseJsonSchema,
      });
      const scripts = scriptsSchema.parse(JSON.parse(response));
      log.info("Short voice-over scripts generated", {
        candidateId,
        durationMs: Math.round(performance.now() - scriptStartedAt),
      });

      const existingByLanguage = new Map(
        (candidate.voiceOvers ?? []).map((item) => [item.language, item]),
      );
      const languageScripts: Array<[VoiceOverLanguage, string]> = [
        ["it", scripts.scriptIt],
        ["en", scripts.scriptEn],
      ];
      const packages: VoiceOverPackage[] = [];

      for (const [language, script] of languageScripts) {
        const languageStartedAt = performance.now();
        const scriptHash = hashVoiceScript(
          script,
          appSettings.brandVoiceProfile,
          language,
        );
        const cached = existingByLanguage.get(language);
        if (cached?.scriptHash === scriptHash) {
          packages.push(cached);
          log.info("Short voice-over package reused", {
            candidateId,
            language,
            durationMs: Math.round(performance.now() - languageStartedAt),
          });
          continue;
        }

        const audioPath = voPath(candidateId, language);
        const ttsStartedAt = performance.now();
        await deps.tts.synthesize({
          text: script,
          voiceProfile: appSettings.brandVoiceProfile,
          outputPath: audioPath,
          instructions: BRAND_TTS_INSTRUCTIONS,
        });
        log.info("Short voice-over synthesis completed", {
          candidateId,
          language,
          durationMs: Math.round(performance.now() - ttsStartedAt),
        });

        const alignStartedAt = performance.now();
        const transcription = await deps.transcription.transcribe(audioPath, {
          words: true,
        });
        const words = transcription.words ?? [];
        log.info("Short voice-over alignment completed", {
          candidateId,
          language,
          wordCount: words.length,
          durationMs: Math.round(performance.now() - alignStartedAt),
        });

        const srtPath = captionPath(audioPath, ".srt");
        const assPath = captionPath(audioPath, ".ass");
        await Promise.all([
          writeText(srtPath, buildSrt(words)),
          writeText(assPath, buildAssKaraoke(words)),
        ]);
        packages.push({
          language,
          script,
          voiceProfile: appSettings.brandVoiceProfile,
          audioPath,
          words,
          srtPath,
          assPath,
          scriptHash,
        });
        log.info("Short voice-over package completed", {
          candidateId,
          language,
          durationMs: Math.round(performance.now() - languageStartedAt),
        });
      }

      await deps.candidates.save({ ...candidate, voiceOvers: packages });
      log.info("Short voice-over generation completed", {
        candidateId,
        packageCount: packages.length,
        reusedCount: packages.filter(
          (item) => existingByLanguage.get(item.language) === item,
        ).length,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return packages;
    } catch (error) {
      log.error("Short voice-over generation failed", {
        candidateId,
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
