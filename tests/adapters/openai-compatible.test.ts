import { describe, expect, it } from "vitest";

import { createOpenAiCompatibleLlm } from "@/src/adapters/llm/openai-compatible";
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

describe("OpenAI-compatible LLM adapter", () => {
  it("requests structured chat completions and returns the message content", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const llm = createOpenAiCompatibleLlm({
      apiKey: "secret",
      baseUrl: "https://llm.example/v1",
      model: "test-model",
      logger: createLogger(),
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"windows":[]}' } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const content = await llm.complete({
      system: "Find moments",
      user: "Analyze video",
      jsonSchema: { type: "object" },
    });

    expect(content).toBe('{"windows":[]}');
    expect(requestBody).toMatchObject({
      model: "test-model",
      messages: [
        { role: "system", content: "Find moments" },
        { role: "user", content: "Analyze video" },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "response",
          strict: true,
          schema: { type: "object" },
        },
      },
    });
  });
});
