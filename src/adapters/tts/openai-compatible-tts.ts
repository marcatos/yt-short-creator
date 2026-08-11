import fs from "node:fs/promises";
import path from "node:path";

import type {
  TtsPort,
  TtsSynthesizeInput,
  TtsSynthesizeResult,
} from "@/src/ports/tts";
import type { Logger } from "@/src/ports/logger";

type OpenAiCompatibleTtsDependencies = {
  apiKey: string;
  baseUrl: string;
  model: string;
  logger: Logger;
  fetch?: typeof globalThis.fetch;
  ensureParentDir?: (outputPath: string) => Promise<void>;
  writeFile?: (outputPath: string, bytes: Uint8Array) => Promise<void>;
};

function speechUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/audio/speech`;
}

function estimateDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1_000, words * 400);
}

export function createOpenAiCompatibleTts(
  deps: OpenAiCompatibleTtsDependencies,
): TtsPort {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const ensureParentDir =
    deps.ensureParentDir ??
    (async (outputPath: string) => {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
    });
  const writeFile =
    deps.writeFile ??
    (async (outputPath: string, bytes: Uint8Array) => {
      await fs.writeFile(outputPath, bytes);
    });
  const log = deps.logger.child({
    component: "OpenAiCompatibleTts",
    model: deps.model,
  });

  return {
    async synthesize(
      input: TtsSynthesizeInput,
    ): Promise<TtsSynthesizeResult> {
      const startedAt = performance.now();
      log.info("TTS synthesis started", {
        outputPath: input.outputPath,
        voiceProfile: input.voiceProfile,
        characterCount: input.text.length,
      });
      try {
        const response = await fetchImpl(speechUrl(deps.baseUrl), {
          method: "POST",
          headers: {
            authorization: `Bearer ${deps.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: deps.model,
            input: input.text,
            voice: input.voiceProfile,
            response_format: "mp3",
          }),
        });
        if (!response.ok) {
          const responseText = await response.text();
          throw new Error(
            `TTS request failed (${response.status}): ${responseText.slice(0, 500)}`,
          );
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        await ensureParentDir(input.outputPath);
        await writeFile(input.outputPath, bytes);
        const headerDuration = Number(
          response.headers.get("x-audio-duration-ms"),
        );
        const durationMs =
          Number.isFinite(headerDuration) && headerDuration > 0
            ? Math.round(headerDuration)
            : estimateDurationMs(input.text);
        log.info("TTS synthesis completed", {
          outputPath: input.outputPath,
          audioDurationMs: durationMs,
          byteCount: bytes.byteLength,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return { durationMs };
      } catch (error) {
        log.error("TTS synthesis failed", {
          outputPath: input.outputPath,
          voiceProfile: input.voiceProfile,
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : String(error),
          durationMs: Math.round(performance.now() - startedAt),
        });
        throw error;
      }
    },
  };
}
