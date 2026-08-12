import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { Logger } from "@/src/ports/logger";
import type {
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
    async transcribe(audioPath: string): Promise<TranscriptionResult> {
      const startedAt = performance.now();
      log.info("Transcription started", {
        audioPath: path.basename(audioPath),
      });

      try {
        const bytes = await fs.readFile(audioPath);
        const form = new FormData();
        form.append(
          "file",
          new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }),
          path.basename(audioPath) || "audio.mp3",
        );
        form.append("model", deps.model);
        form.append("response_format", "verbose_json");

        const response = await fetchImpl(transcriptionsUrl(deps.baseUrl), {
          method: "POST",
          headers: {
            authorization: `Bearer ${deps.apiKey}`,
          },
          body: form,
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
        };

        log.info("Transcription completed", {
          segmentCount: result.segments.length,
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
