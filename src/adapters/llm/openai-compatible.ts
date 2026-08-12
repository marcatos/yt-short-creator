import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type {
  LlmCompleteInput,
  LlmPort,
  LlmUserPart,
} from "@/src/ports/llm";
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

function mimeForImage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

async function partToOpenAiContent(
  part: LlmUserPart,
): Promise<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
> {
  if (part.type === "text") {
    return { type: "text", text: part.text };
  }

  if (
    part.imagePathOrUrl.startsWith("data:") ||
    part.imagePathOrUrl.startsWith("http://") ||
    part.imagePathOrUrl.startsWith("https://")
  ) {
    return {
      type: "image_url",
      image_url: { url: part.imagePathOrUrl },
    };
  }

  const bytes = await fs.readFile(part.imagePathOrUrl);
  const base64 = bytes.toString("base64");
  const mime = mimeForImage(part.imagePathOrUrl);
  return {
    type: "image_url",
    image_url: { url: `data:${mime};base64,${base64}` },
  };
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
      const multimodal = Boolean(input.userParts?.length);
      log.info("LLM completion started", {
        structuredOutput: input.jsonSchema !== undefined,
        multimodal,
        partCount: input.userParts?.length ?? 0,
      });

      try {
        const userContent = input.userParts?.length
          ? await Promise.all(input.userParts.map(partToOpenAiContent))
          : input.user;

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
              { role: "user", content: userContent },
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
          multimodal,
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
