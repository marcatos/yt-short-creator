import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { Logger } from "@/src/ports/logger";
import type {
  TranscriptionOptions,
  TranscriptionPort,
  TranscriptionResult,
} from "@/src/ports/transcription";

const verboseSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  segments: z
    .array(
      z.object({
        start: z.number(),
        end: z.number(),
        text: z.string(),
      }),
    )
    .optional(),
  words: z
    .array(
      z.object({
        word: z.string(),
        start: z.number(),
        end: z.number(),
      }),
    )
    .optional(),
});

type WhisperDeps = {
  apiKey: string;
  baseUrl: string;
  model: string;
  logger: Logger;
  fetch?: typeof globalThis.fetch;
};

function transcriptionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/audio/transcriptions`;
}

export function createOpenAiCompatibleWhisper(
  deps: WhisperDeps,
): TranscriptionPort {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const log = deps.logger.child({
    component: "OpenAiCompatibleWhisper",
    model: deps.model,
  });

  return {
    async transcribe(
      audioPath: string,
      options?: TranscriptionOptions,
    ): Promise<TranscriptionResult> {
      const startedAt = performance.now();
      log.info("Transcription started", {
        audioPath: path.basename(audioPath),
        wordTimestampsRequested: options?.words === true,
      });

      try {
        const preparationStartedAt = performance.now();
        const bytes = await fs.readFile(audioPath);
        const form = new FormData();
        form.append(
          "file",
          new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }),
          path.basename(audioPath) || "audio.mp3",
        );
        form.append("model", deps.model);
        form.append("response_format", "verbose_json");
        if (options?.words === true) {
          form.append("timestamp_granularities[]", "word");
        }
        log.info("Transcription input prepared", {
          audioPath: path.basename(audioPath),
          byteCount: bytes.byteLength,
          wordTimestampsRequested: options?.words === true,
          durationMs: Math.round(performance.now() - preparationStartedAt),
        });

        const requestStartedAt = performance.now();
        const response = await fetchImpl(transcriptionsUrl(deps.baseUrl), {
          method: "POST",
          headers: {
            authorization: `Bearer ${deps.apiKey}`,
          },
          body: form,
        });
        log.info("Transcription API request completed", {
          status: response.status,
          ok: response.ok,
          durationMs: Math.round(performance.now() - requestStartedAt),
        });

        if (!response.ok) {
          const responseText = await response.text();
          throw new Error(
            `Transcription failed (${response.status}): ${responseText.slice(0, 500)}`,
          );
        }

        const parsed = verboseSchema.parse(await response.json());
        const result: TranscriptionResult = {
          text: parsed.text.trim(),
          language: parsed.language ?? null,
          segments: (parsed.segments ?? []).map((segment) => ({
            startMs: Math.max(0, Math.round(segment.start * 1_000)),
            endMs: Math.max(0, Math.round(segment.end * 1_000)),
            text: segment.text.trim(),
          })),
          ...(parsed.words === undefined
            ? {}
            : {
                words: parsed.words.map((word) => ({
                  text: word.word.trim(),
                  startMs: Math.max(0, Math.round(word.start * 1_000)),
                  endMs: Math.max(0, Math.round(word.end * 1_000)),
                })),
              }),
        };

        log.info("Transcription completed", {
          segmentCount: result.segments.length,
          wordCount: result.words?.length ?? 0,
          textChars: result.text.length,
          language: result.language,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return result;
      } catch (error) {
        log.error("Transcription failed", {
          durationMs: Math.round(performance.now() - startedAt),
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : String(error),
        });
        throw error;
      }
    },
  };
}
