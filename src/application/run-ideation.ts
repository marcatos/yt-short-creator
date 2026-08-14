import { z } from "zod";

import type {
  GenerateProvenance,
  GenerationBrief,
  ShortCandidate,
} from "@/src/domain/entities";
import type { InspirationConfig } from "@/src/domain/inspiration-config";
import { selectIdeasForGenerateFill } from "@/src/domain/inspiration";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { GenerationBriefRepository } from "@/src/ports/generation-brief-repository";
import type { IdPort } from "@/src/ports/id";
import type { InspirationStorePort } from "@/src/ports/inspiration-store";
import type { LlmPort } from "@/src/ports/llm";
import type { Logger } from "@/src/ports/logger";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { TtsPort } from "@/src/ports/tts";

import { applyInspirationToBatchIfConfigured } from "./apply-inspiration-to-batch";
import {
  formatInspirationPromptBlock,
  loadInspirationPromptBlock,
  recordToInspirationIdea,
} from "./inspiration-prompt-block";

const ideaSchema = z.object({
  hook: z.string().trim().min(1),
  script: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).max(12),
  score: z.number().min(0).max(1),
  voiceProfile: z.string().trim().min(1),
  brollPlan: z.array(z.string().trim().min(1)).max(20),
});

const ideationSchema = z.object({
  ideas: z.array(ideaSchema).max(10),
});

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ideas"],
  properties: {
    ideas: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "hook",
          "script",
          "title",
          "description",
          "tags",
          "score",
          "voiceProfile",
          "brollPlan",
        ],
        properties: {
          hook: { type: "string" },
          script: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          tags: { type: "array", items: { type: "string" }, maxItems: 12 },
          score: { type: "number", minimum: 0, maximum: 1 },
          voiceProfile: { type: "string" },
          brollPlan: {
            type: "array",
            items: { type: "string" },
            maxItems: 20,
          },
        },
      },
    },
  },
} satisfies Record<string, unknown>;

type IdeationDependencies = {
  llm: LlmPort;
  tts: TtsPort;
  mediaStore: MediaStorePort;
  briefs: GenerationBriefRepository;
  candidates: CandidateRepository;
  id: IdPort;
  clock: ClockPort;
  logger: Logger;
  inspirationStore?: InspirationStorePort;
  inspirationConfig?: InspirationConfig;
};

export type RunIdeation = (input: {
  channelId: string;
  count: number;
}) => Promise<ShortCandidate[]>;

export type AssembleGeneratePreview = (input: {
  candidateId: string;
}) => Promise<ShortCandidate>;

type PreviewDependencies = Pick<
  IdeationDependencies,
  "tts" | "mediaStore" | "briefs" | "candidates" | "clock" | "logger"
>;

function createTimeline(
  assets: string[],
  durationMs: number,
): GenerateProvenance["timeline"] {
  if (assets.length === 0) return [];
  return assets.map((asset, index) => ({
    asset,
    startMs: Math.round((durationMs * index) / assets.length),
    endMs: Math.round((durationMs * (index + 1)) / assets.length),
  }));
}

async function assemblePreview(
  deps: PreviewDependencies,
  candidate: ShortCandidate,
  brief: GenerationBrief,
  brollFiles: string[],
  brollOffset: number,
): Promise<ShortCandidate> {
  const outputPath = deps.mediaStore.audioPath(candidate.id);
  const { durationMs } = await deps.tts.synthesize({
    text: brief.script,
    voiceProfile: brief.voiceProfile,
    outputPath,
  });
  const planLength = brief.brollPlan.length;
  const assets =
    brollFiles.length === 0
      ? []
      : Array.from(
          { length: Math.max(planLength, 1) },
          (_, index) =>
            deps.mediaStore.brollPath(
              brollFiles[(brollOffset + index) % brollFiles.length],
            ),
        );
  const updated: ShortCandidate = {
    ...candidate,
    provenance: {
      generationBriefId: brief.id,
      scriptVersion: 1,
      voiceAssetPath: outputPath,
      timeline: createTimeline(assets, durationMs),
    },
    updatedAt: deps.clock.now(),
  };
  await deps.candidates.save(updated);
  return updated;
}

type IdeationIdea = z.infer<typeof ideaSchema>;

async function materializeIdeas(
  deps: IdeationDependencies,
  channelId: string,
  ideas: IdeationIdea[],
  brollFiles: string[],
  brollOffsetStart: number,
): Promise<{ candidates: ShortCandidate[]; brollOffset: number }> {
  const created: ShortCandidate[] = [];
  let brollOffset = brollOffsetStart;
  for (const idea of ideas) {
    const createdAt = deps.clock.now();
    const briefId = deps.id.generate();
    const candidateId = deps.id.generate();
    const planLength =
      brollFiles.length === 0
        ? idea.brollPlan.length
        : Math.max(1, idea.brollPlan.length);
    const brief: GenerationBrief = {
      id: briefId,
      channelId,
      hook: idea.hook,
      script: idea.script,
      voiceProfile: idea.voiceProfile,
      brollPlan: Array.from({ length: planLength }, (_, index) => ({
        asset:
          brollFiles.length === 0
            ? ""
            : deps.mediaStore.brollPath(
                brollFiles[(brollOffset + index) % brollFiles.length],
              ),
        description: idea.brollPlan[index] ?? "Supporting racing footage",
      })),
      createdAt,
    };
    const candidate: ShortCandidate = {
      id: candidateId,
      origin: "generate",
      status: "proposed",
      title: idea.title,
      description: idea.description,
      tags: idea.tags,
      score: idea.score,
      provenance: {
        generationBriefId: briefId,
        scriptVersion: 1,
        voiceAssetPath: "",
        timeline: [],
      },
      renderOutputPath: null,
      scheduledAt: null,
      createdAt,
      updatedAt: createdAt,
    };
    await deps.briefs.save(brief);
    created.push(
      await assemblePreview(deps, candidate, brief, brollFiles, brollOffset),
    );
    brollOffset += Math.max(planLength, 1);
  }
  return { candidates: created, brollOffset };
}

async function generateInspirationFill(
  deps: IdeationDependencies,
  log: Logger,
  input: {
    channelId: string;
    shortfall: number;
    matchedIdeaIds: string[];
    brollFiles: string[];
    brollOffset: number;
  },
): Promise<ShortCandidate[]> {
  const store = deps.inspirationStore;
  if (!store || input.shortfall <= 0) {
    return [];
  }
  const fillMax = deps.inspirationConfig?.generateFillMax ?? 3;
  const records = await store.listActiveIdeas();
  const unmatched = selectIdeasForGenerateFill(
    records.map(recordToInspirationIdea),
    new Set(input.matchedIdeaIds),
    Math.min(input.shortfall, fillMax),
  );
  if (unmatched.length === 0) {
    return [];
  }

  const fillStarted = performance.now();
  log.info("Inspiration generate fill started", {
    fillCount: unmatched.length,
    shortfall: input.shortfall,
  });
  try {
    const response = await deps.llm.complete({
      system:
        "Create concise Italian YouTube Shorts ideas for a motorsport channel. Each script must open with its hook and fit within 60 seconds.",
      user: [
        `Channel ID: ${input.channelId}`,
        `Create exactly ${unmatched.length} distinct ideas aligned with these unmatched YouTube Inspiration ideas.`,
        "Prefer their angles and titles. Do not invent facts.",
        formatInspirationPromptBlock(unmatched),
      ].join("\n"),
      jsonSchema: responseJsonSchema,
    });
    const fillIdeas = ideationSchema
      .parse(JSON.parse(response))
      .ideas.slice(0, unmatched.length);
    const materialized = await materializeIdeas(
      deps,
      input.channelId,
      fillIdeas,
      input.brollFiles,
      input.brollOffset,
    );
    const applied = await applyInspirationToBatchIfConfigured(
      {
        store: deps.inspirationStore,
        config: deps.inspirationConfig,
        clock: deps.clock,
        logger: log,
      },
      materialized.candidates,
      async (ordered) => {
        await Promise.all(
          ordered.map((candidate) => deps.candidates.save(candidate)),
        );
      },
    );
    log.info("Inspiration generate fill completed", {
      fillCount: applied.candidates.length,
      durationMs: Math.round(performance.now() - fillStarted),
    });
    return applied.candidates;
  } catch (error) {
    log.warn("Inspiration generate fill failed; continuing without extra ideas", {
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : String(error),
      durationMs: Math.round(performance.now() - fillStarted),
    });
    return [];
  }
}

export function createRunIdeation(deps: IdeationDependencies): RunIdeation {
  const log = deps.logger.child({ operation: "runIdeation" });

  return async ({ channelId, count }): Promise<ShortCandidate[]> => {
    const startedAt = performance.now();
    log.info("Ideation started", { channelId, requestedCount: count });
    try {
      if (!Number.isInteger(count) || count < 1 || count > 10) {
        throw new Error("Ideation count must be an integer between 1 and 10");
      }
      await deps.mediaStore.ensureDirs();
      const brollFiles = await deps.mediaStore.listBroll();

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
          "Create concise Italian YouTube Shorts ideas for a motorsport channel. Each script must open with its hook and fit within 60 seconds.",
        user: [
          `Channel ID: ${channelId}`,
          `Create exactly ${count} distinct ideas with metadata and a shot-by-shot B-roll plan.`,
          inspirationBlock,
        ]
          .filter(Boolean)
          .join("\n"),
        jsonSchema: responseJsonSchema,
      });
      const ideas = ideationSchema.parse(JSON.parse(response)).ideas.slice(
        0,
        count,
      );
      const materialized = await materializeIdeas(
        deps,
        channelId,
        ideas,
        brollFiles,
        0,
      );
      const applied = await applyInspirationToBatchIfConfigured(
        {
          store: deps.inspirationStore,
          config: deps.inspirationConfig,
          clock: deps.clock,
          logger: log,
        },
        materialized.candidates,
        async (ordered) => {
          await Promise.all(
            ordered.map((candidate) => deps.candidates.save(candidate)),
          );
        },
      );

      let created = applied.candidates;
      if (applied.shortfall > 0 && !applied.stale) {
        const fill = await generateInspirationFill(deps, log, {
          channelId,
          shortfall: applied.shortfall,
          matchedIdeaIds: applied.matchedIdeaIds,
          brollFiles,
          brollOffset: materialized.brollOffset,
        });
        created = [...created, ...fill];
      }

      log.info("Ideation completed", {
        channelId,
        candidateCount: created.length,
        brollAssetCount: brollFiles.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return created;
    } catch (error) {
      log.error("Ideation failed", {
        channelId,
        requestedCount: count,
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

export function createAssembleGeneratePreview(
  deps: PreviewDependencies,
): AssembleGeneratePreview {
  const log = deps.logger.child({ operation: "assembleGeneratePreview" });
  return async ({ candidateId }) => {
    const startedAt = performance.now();
    log.info("Generate preview assembly started", { candidateId });
    try {
      const candidate = await deps.candidates.getById(candidateId);
      if (!candidate || candidate.origin !== "generate") {
        throw new Error(`Generate candidate not found: ${candidateId}`);
      }
      const provenance = candidate.provenance as GenerateProvenance;
      const brief = await deps.briefs.getById(provenance.generationBriefId);
      if (!brief) throw new Error(`Generation brief not found: ${provenance.generationBriefId}`);
      await deps.mediaStore.ensureDirs();
      const updated = await assemblePreview(
        deps,
        candidate,
        brief,
        await deps.mediaStore.listBroll(),
        0,
      );
      log.info("Generate preview assembly completed", {
        candidateId,
        timelineAssetCount: (updated.provenance as GenerateProvenance).timeline.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return updated;
    } catch (error) {
      log.error("Generate preview assembly failed", {
        candidateId,
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
