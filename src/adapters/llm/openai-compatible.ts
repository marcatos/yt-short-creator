import { z } from "zod";

import type { LlmCompleteInput, LlmPort } from "@/src/ports/llm";
import type { Logger } from "@/src/ports/logger";

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() }),
      }),
    )
    .min(1),
});

type OpenAiCompatibleLlmDependencies = {
  apiKey: string;
  baseUrl: string;
  model: string;
  logger: Logger;
  fetch?: typeof globalThis.fetch;
};

function completionUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

export function createOpenAiCompatibleLlm(
  deps: OpenAiCompatibleLlmDependencies,
): LlmPort {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const log = deps.logger.child({
    component: "OpenAiCompatibleLlm",
    model: deps.model,
  });

  return {
    async complete(input: LlmCompleteInput): Promise<string> {
      const startedAt = performance.now();
      log.info("LLM completion started", {
        structuredOutput: input.jsonSchema !== undefined,
      });

      try {
        const response = await fetchImpl(completionUrl(deps.baseUrl), {
          method: "POST",
          headers: {
            authorization: `Bearer ${deps.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: deps.model,
            messages: [
              { role: "system", content: input.system },
              { role: "user", content: input.user },
            ],
            ...(input.jsonSchema
              ? {
                  response_format: {
                    type: "json_schema",
                    json_schema: {
                      name: "response",
                      strict: true,
                      schema: input.jsonSchema,
                    },
                  },
                }
              : {}),
          }),
        });

        if (!response.ok) {
          const responseText = await response.text();
          throw new Error(
            `LLM request failed (${response.status}): ${responseText.slice(0, 500)}`,
          );
        }

        const completion = completionSchema.parse(await response.json());
        log.info("LLM completion completed", {
          durationMs: Math.round(performance.now() - startedAt),
        });
        return completion.choices[0].message.content;
      } catch (error) {
        log.error("LLM completion failed", {
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
