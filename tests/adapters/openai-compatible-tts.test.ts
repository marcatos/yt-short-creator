import { describe, expect, it } from "vitest";

import { createOpenAiCompatibleTts } from "@/src/adapters/tts/openai-compatible-tts";
import type { Logger } from "@/src/ports/logger";

function createLogger(): Logger {
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child: () => logger,
  };
  return logger;
}

describe("OpenAI-compatible TTS adapter", () => {
  it("requests speech audio and writes it to the requested path", async () => {
    let requestBody: Record<string, unknown> | undefined;
    let written: { path: string; bytes: Uint8Array } | undefined;
    const tts = createOpenAiCompatibleTts({
      apiKey: "secret",
      baseUrl: "https://tts.example/v1",
      model: "speech-model",
      logger: createLogger(),
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "x-audio-duration-ms": "4200" },
        });
      },
      ensureParentDir: async () => {},
      writeFile: async (path, bytes) => {
        written = { path, bytes };
      },
    });

    const result = await tts.synthesize({
      text: "Una breve storia di gara.",
      voiceProfile: "alloy",
      outputPath: "media/audio/candidate-1.mp3",
    });

    expect(requestBody).toEqual({
      model: "speech-model",
      input: "Una breve storia di gara.",
      voice: "alloy",
      response_format: "mp3",
    });
    expect(written).toEqual({
      path: "media/audio/candidate-1.mp3",
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(result).toEqual({ durationMs: 4200 });
  });
});
