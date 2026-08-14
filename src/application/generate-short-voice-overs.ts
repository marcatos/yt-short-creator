import path from "node:path";

import { z } from "zod";

import type { ShortCandidate } from "@/src/domain/entities";
import type { RaceAnalysis } from "@/src/domain/race-analysis";
import {
  RACE_METADATA_STYLE,
  RACE_VOICE_OVER_STYLE,
} from "@/src/domain/race-copy-style";
import {
  resolveFocusSubject,
  sliceHudWindow,
  summarizeHudForNarration,
  type RaceHudTimeline,
} from "@/src/domain/race-hud";
import {
  buildAssKaraoke,
  buildSrt,
  hashVoiceScript,
  ttsInstructionsFor,
  type VoiceOverLanguage,
  type VoiceOverPackage,
} from "@/src/domain/voice-over";
import type { AppSettings } from "@/src/ports/settings-repository";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { LlmPort } from "@/src/ports/llm";
import type { Logger } from "@/src/ports/logger";
import type { MediaDurationPort } from "@/src/ports/media-duration";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";
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

const SYSTEM_PROMPT = `${RACE_VOICE_OVER_STYLE}

Write a YouTube Short voice-over lasting 8–25 spoken seconds.
Hook in the first 2 seconds with a concrete race moment (positions, battle, mistake, recovery), then end with a CTA to subscribe or watch the full race.
Use verified HUD / raceAnalysis facts when provided (positions, gaps, rivals) — never invent them.
Also return concise localized titles and descriptions (${RACE_METADATA_STYLE}).`;

function voiceProfileForLanguage(
  settings: Pick<AppSettings, "brandVoiceProfile" | "italianVoiceProfile">,
  language: VoiceOverLanguage,
): string {
  return language === "it"
    ? settings.italianVoiceProfile
    : settings.brandVoiceProfile;
}

const MIN_VOICE_OVER_DURATION_MS = 8_000;
const MAX_VOICE_OVER_DURATION_MS = 25_000;

type Dependencies = {
  llm: LlmPort;
  tts: TtsPort;
  transcription: TranscriptionPort;
  mediaStore: MediaStorePort;
  candidates: CandidateRepository;
  settings: SettingsRepository;
  logger: Logger;
  /** Measures the rendered narration so the 8–25 s gate sees real audio. */
  mediaDuration?: MediaDurationPort;
  /** Optional — enriches Short VO with session raceAnalysis / HUD window. */
  replaySessions?: ReplaySessionRepository;
};

export type GenerateShortVoiceOvers = (input: {
  candidateId: string;
}) => Promise<VoiceOverPackage[]>;

function overlappingEvents(
  analysis: RaceAnalysis,
  startMs: number,
  endMs: number,
) {
  return analysis.events.filter(
    (event) => event.endMs >= startMs && event.startMs <= endMs,
  );
}

/** Exported for unit tests. */
export function candidateContext(
  candidate: ShortCandidate,
  analysis: RaceAnalysis | null | undefined,
): string {
  const provenance = candidate.provenance;
  const startMs =
    "startMs" in provenance && typeof provenance.startMs === "number"
      ? provenance.startMs
      : 0;
  const endMs =
    "endMs" in provenance && typeof provenance.endMs === "number"
      ? provenance.endMs
      : startMs;
  const hudTimeline: RaceHudTimeline = analysis?.hudTimeline ?? [];
  const hudWindow = sliceHudWindow(hudTimeline, startMs, endMs);
  const subject = resolveFocusSubject(
    hudTimeline.length ? hudTimeline : hudWindow,
    analysis?.focusCarHint ?? "",
  );
  const payload: Record<string, unknown> = {
    id: candidate.id,
    origin: candidate.origin,
    title: candidate.title,
    description: candidate.description,
    tags: candidate.tags,
    provenance: candidate.provenance,
  };

  if (analysis) {
    payload.raceFacts = {
      focusCarHint: analysis.focusCarHint,
      results: analysis.results,
      recurringRivals: analysis.recurringRivals,
      eventsInWindow: overlappingEvents(analysis, startMs, endMs).slice(0, 12),
    };
  }

  if (hudWindow.length || hudTimeline.length) {
    payload.hudWindow = summarizeHudForNarration(
      hudWindow.length ? hudWindow : sliceHudWindow(hudTimeline, startMs, endMs),
      subject.carNumber,
    );
  }

  return JSON.stringify(payload);
}

function captionPath(audioPath: string, extension: ".srt" | ".ass"): string {
  const parsed = path.parse(audioPath);
  return path.join(parsed.dir, `${parsed.name}${extension}`);
}

export function createGenerateShortVoiceOvers(
  deps: Dependencies,
): GenerateShortVoiceOvers {
  const log = deps.logger.child({ operation: "generateShortVoiceOvers" });

  /**
   * Rendered length of the narration. TTS adapters may only return an estimate
   * (words × constant), which can clear the 8–25 s gate that the actual file
   * would fail, so the probed file wins and the estimate is the fallback.
   */
  async function measureNarrationMs(
    audioPath: string,
    estimateMs: number,
    context: Record<string, unknown>,
  ): Promise<{ durationMs: number; source: "probe" | "estimate" }> {
    if (deps.mediaDuration) {
      try {
        const seconds = await deps.mediaDuration.probeDurationSec(audioPath);
        if (seconds !== null && Number.isFinite(seconds) && seconds > 0) {
          return { durationMs: Math.round(seconds * 1_000), source: "probe" };
        }
        log.warn("Voice-over duration probe returned no usable value", {
          ...context,
          audioPath,
        });
      } catch (error) {
        log.warn("Voice-over duration probe failed", {
          ...context,
          audioPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { durationMs: estimateMs, source: "estimate" };
  }

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
      let raceAnalysis: RaceAnalysis | null = null;
      const provenance = candidate.provenance;
      const sessionId =
        "replaySessionId" in provenance &&
        typeof provenance.replaySessionId === "string"
          ? provenance.replaySessionId
          : null;
      if (sessionId && deps.replaySessions) {
        const session = await deps.replaySessions.getById(sessionId);
        raceAnalysis = session?.raceAnalysis ?? null;
      }
      const response = await deps.llm.complete({
        system: SYSTEM_PROMPT,
        user: `Create bilingual voice-over copy for this candidate:\n${candidateContext(candidate, raceAnalysis)}`,
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
      const languageScripts: Array<{
        language: VoiceOverLanguage;
        script: string;
        title: string;
        description: string;
      }> = [
        {
          language: "it",
          script: scripts.scriptIt,
          title: scripts.titleIt,
          description: scripts.descriptionIt,
        },
        {
          language: "en",
          script: scripts.scriptEn,
          title: scripts.titleEn,
          description: scripts.descriptionEn,
        },
      ];
      const packages: VoiceOverPackage[] = [];
      let reusedCount = 0;

      for (const { language, script, title, description } of languageScripts) {
        const languageStartedAt = performance.now();
        const voiceProfile = voiceProfileForLanguage(appSettings, language);
        const scriptHash = hashVoiceScript(
          script,
          voiceProfile,
          language,
        );
        const cached = existingByLanguage.get(language);
        if (cached?.scriptHash === scriptHash) {
          packages.push({ ...cached, title, description });
          reusedCount += 1;
          log.info("Short voice-over package reused", {
            candidateId,
            language,
            durationMs: Math.round(performance.now() - languageStartedAt),
          });
          continue;
        }

        const audioPath = voPath(candidateId, language);
        const ttsStartedAt = performance.now();
        const synthesis = await deps.tts.synthesize({
          text: script,
          voiceProfile,
          outputPath: audioPath,
          instructions: ttsInstructionsFor(language),
        });
        const measured = await measureNarrationMs(
          audioPath,
          synthesis.durationMs,
          { candidateId, language },
        );
        if (
          measured.durationMs < MIN_VOICE_OVER_DURATION_MS ||
          measured.durationMs > MAX_VOICE_OVER_DURATION_MS
        ) {
          throw new Error(
            `Voice-over duration for ${language} must be between 8,000 and 25,000 ms; received ${measured.durationMs} ms`,
          );
        }
        log.info("Short voice-over synthesis completed", {
          candidateId,
          language,
          audioDurationMs: measured.durationMs,
          durationSource: measured.source,
          durationMs: Math.round(performance.now() - ttsStartedAt),
        });

        const alignStartedAt = performance.now();
        const transcription = await deps.transcription.transcribe(audioPath, {
          words: true,
        });
        const words = transcription.words ?? [];
        if (words.length === 0) {
          throw new Error(
            `Voice-over alignment for ${language} returned no word timestamps`,
          );
        }
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
          title,
          description,
          voiceProfile,
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

      const freshCandidate = await deps.candidates.getById(candidateId);
      if (!freshCandidate) {
        throw new Error(`Short candidate not found before VO save: ${candidateId}`);
      }
      await deps.candidates.save({ ...freshCandidate, voiceOvers: packages });
      log.info("Short voice-over generation completed", {
        candidateId,
        packageCount: packages.length,
        reusedCount,
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
