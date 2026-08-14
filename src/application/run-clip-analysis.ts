import { z } from "zod";

import type { ShortCandidate } from "@/src/domain/entities";
import { withFullVideoLink } from "@/src/domain/full-video-link";
import type { InspirationConfig } from "@/src/domain/inspiration-config";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { IdPort } from "@/src/ports/id";
import type { InspirationStorePort } from "@/src/ports/inspiration-store";
import type { LlmPort } from "@/src/ports/llm";
import type { Logger } from "@/src/ports/logger";
import type { SourceVideoRepository } from "@/src/ports/source-video-repository";
import type { VideoDownloadPort } from "@/src/ports/video-download";

import { applyInspirationToBatchIfConfigured } from "./apply-inspiration-to-batch";
import { loadInspirationPromptBlock } from "./inspiration-prompt-block";

const clipWindowSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).max(12),
  score: z.number().min(0).max(1),
  hookReason: z.string().trim().min(1),
});

const analysisSchema = z.object({
  windows: z.array(clipWindowSchema).max(10),
});

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["windows"],
  properties: {
    windows: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "startMs",
          "endMs",
          "title",
          "description",
          "tags",
          "score",
          "hookReason",
        ],
        properties: {
          startMs: { type: "integer", minimum: 0 },
          endMs: { type: "integer", minimum: 1 },
          title: { type: "string" },
          description: { type: "string" },
          tags: { type: "array", items: { type: "string" }, maxItems: 12 },
          score: { type: "number", minimum: 0, maximum: 1 },
          hookReason: { type: "string" },
        },
      },
    },
  },
} satisfies Record<string, unknown>;

type RunClipAnalysisDependencies = {
  llm: LlmPort;
  videoDownload: VideoDownloadPort;
  sourceVideos: SourceVideoRepository;
  candidates: CandidateRepository;
  id: IdPort;
  clock: ClockPort;
  logger: Logger;
  inspirationStore?: InspirationStorePort;
  inspirationConfig?: InspirationConfig;
};

export type RunClipAnalysis = (input: {
  sourceVideoId: string;
}) => Promise<ShortCandidate[]>;

export function createRunClipAnalysis(
  deps: RunClipAnalysisDependencies,
): RunClipAnalysis {
  const log = deps.logger.child({ operation: "runClipAnalysis" });

  return async ({ sourceVideoId }): Promise<ShortCandidate[]> => {
    const startedAt = performance.now();
    log.info("Clip analysis started", { sourceVideoId });

    try {
      const source = await deps.sourceVideos.getById(sourceVideoId);
      if (!source) {
        throw new Error(`Source video not found: ${sourceVideoId}`);
      }

      let localMediaPath = source.localMediaPath;
      if (!localMediaPath) {
        log.info("Downloading source for clip analysis", {
          sourceVideoId,
          youtubeVideoId: source.youtubeVideoId,
        });
        localMediaPath = await deps.videoDownload.download(source.youtubeVideoId);
        await deps.sourceVideos.save({ ...source, localMediaPath });
      }

      let inspirationBlock = "";
      try {
        inspirationBlock = await loadInspirationPromptBlock(deps.inspirationStore);
      } catch (error) {
        log.warn("Failed to load inspiration prompt; continuing", {
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : String(error),
        });
      }

      const response = await deps.llm.complete({
        system:
          "Identify compelling self-contained vertical-video moments. Return 8-60 second windows only, using millisecond timestamps and truthful metadata.",
        user: [
          `Source title: ${source.title}`,
          `Duration: ${source.durationSec} seconds`,
          `Local media reference: ${localMediaPath}`,
          "Select up to 10 moments. Prefer a strong opening hook and complete thought.",
          inspirationBlock,
        ]
          .filter(Boolean)
          .join("\n"),
        jsonSchema: responseJsonSchema,
      });
      const parsed = analysisSchema.parse(JSON.parse(response));
      const maxEndMs = source.durationSec * 1_000;
      const validWindows = parsed.windows.filter(({ startMs, endMs }) => {
        const durationMs = endMs - startMs;
        return (
          endMs <= maxEndMs &&
          durationMs >= 8_000 &&
          durationMs <= 60_000
        );
      });
      const createdAt = deps.clock.now();
      const candidates = validWindows.map(
        (window): ShortCandidate => ({
          id: deps.id.generate(),
          origin: "clip",
          status: "proposed",
          title: window.title,
          description: withFullVideoLink(
            window.description,
            source.youtubeVideoId,
          ),
          tags: window.tags,
          score: window.score,
          provenance: {
            sourceVideoId,
            startMs: window.startMs,
            endMs: window.endMs,
            hookReason: window.hookReason,
            crop: { mode: "center_vertical", focusX: 0.5 },
          },
          renderOutputPath: null,
          scheduledAt: null,
          createdAt,
          updatedAt: createdAt,
        }),
      );

      const applied = await applyInspirationToBatchIfConfigured(
        {
          store: deps.inspirationStore,
          config: deps.inspirationConfig,
          clock: deps.clock,
          logger: log,
        },
        candidates,
        async (ordered) => {
          await Promise.all(
            ordered.map((candidate) => deps.candidates.save(candidate)),
          );
        },
      );
      log.info("Clip analysis completed", {
        sourceVideoId,
        proposedCount: applied.candidates.length,
        rejectedWindowCount: parsed.windows.length - candidates.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return applied.candidates;
    } catch (error) {
      log.error("Clip analysis failed", {
        sourceVideoId,
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
