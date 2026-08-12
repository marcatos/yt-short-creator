import { describe, expect, it } from "vitest";

import { createOpenAiCompatibleTts } from "@/src/adapters/tts/openai-compatible-tts";
import { BRAND_TTS_INSTRUCTIONS } from "@/src/domain/voice-over";
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

describe("OpenAI-compatible TTS instructions", () => {
  it("includes brand instructions in the speech request when provided", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const tts = createOpenAiCompatibleTts({
      apiKey: "secret",
      baseUrl: "https://tts.example/v1",
      model: "speech-model",
      logger: createLogger(),
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(new Uint8Array([1]), { status: 200 });
      },
      ensureParentDir: async () => {},
      writeFile: async () => {},
    });

    await tts.synthesize({
      text: "Welcome to the race.",
      voiceProfile: "alloy",
      outputPath: "media/audio/voice-over.mp3",
      instructions: BRAND_TTS_INSTRUCTIONS,
    });

    expect(requestBody?.instructions).toBe(BRAND_TTS_INSTRUCTIONS);
    expect(String(requestBody?.instructions)).toMatch(/First-person simracing driver/);
  });
});
