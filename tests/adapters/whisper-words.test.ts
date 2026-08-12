import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createOpenAiCompatibleWhisper } from "@/src/adapters/transcription/openai-compatible-whisper";
import type { Logger } from "@/src/ports/logger";

type InfoLog = {
  message: string;
  context?: Record<string, unknown>;
};

function createLogger(infoLogs: InfoLog[] = []): Logger {
  const logger: Logger = {
    debug() {},
    info(message, context) {
      infoLogs.push({ message, context });
    },
    warn() {},
    error() {},
    child: () => logger,
  };
  return logger;
}

describe("OpenAI-compatible Whisper word timestamps", () => {
  it("requests word timestamps and maps seconds to milliseconds", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "whisper-words-"));
    const audioPath = path.join(tempDir, "voice-over.mp3");
    await fs.writeFile(audioPath, new Uint8Array([1, 2, 3]));
    let requestForm: FormData | undefined;
    const whisper = createOpenAiCompatibleWhisper({
      apiKey: "secret",
      baseUrl: "https://whisper.example/v1",
      model: "whisper-model",
      logger: createLogger(),
      fetch: async (_input, init) => {
        requestForm = init?.body as FormData;
        return Response.json({
          text: "Lights out",
          language: "en",
          segments: [],
          words: [
            { word: "Lights", start: 0.125, end: 0.5 },
            { word: "out", start: 0.55, end: 1.2345 },
          ],
        });
      },
    });

    try {
      const result = await whisper.transcribe(audioPath, { words: true });

      expect(requestForm?.get("response_format")).toBe("verbose_json");
      expect(requestForm?.getAll("timestamp_granularities[]")).toEqual(["word"]);
      expect(result.words).toEqual([
        { text: "Lights", startMs: 125, endMs: 500 },
        { text: "out", startMs: 550, endMs: 1235 },
      ]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("omits word timestamp granularity when called without options", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "whisper-default-"));
    const audioPath = path.join(tempDir, "voice-over.mp3");
    await fs.writeFile(audioPath, new Uint8Array([1, 2, 3]));
    let requestForm: FormData | undefined;
    const whisper = createOpenAiCompatibleWhisper({
      apiKey: "secret",
      baseUrl: "https://whisper.example/v1",
      model: "whisper-model",
      logger: createLogger(),
      fetch: async (_input, init) => {
        requestForm = init?.body as FormData;
        return Response.json({ text: "Lights out", segments: [] });
      },
    });

    try {
      await whisper.transcribe(audioPath);

      expect(requestForm?.has("timestamp_granularities[]")).toBe(false);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("logs input preparation and API request step durations", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "whisper-logs-"));
    const audioPath = path.join(tempDir, "voice-over.mp3");
    await fs.writeFile(audioPath, new Uint8Array([1, 2, 3]));
    const infoLogs: InfoLog[] = [];
    const whisper = createOpenAiCompatibleWhisper({
      apiKey: "secret",
      baseUrl: "https://whisper.example/v1",
      model: "whisper-model",
      logger: createLogger(infoLogs),
      fetch: async () => Response.json({ text: "Lights out", segments: [] }),
    });

    try {
      await whisper.transcribe(audioPath);

      for (const message of [
        "Transcription input prepared",
        "Transcription API request completed",
      ]) {
        expect(infoLogs).toContainEqual({
          message,
          context: expect.objectContaining({
            durationMs: expect.any(Number),
          }),
        });
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
