import { z } from "zod";

import type {
  GenerateProvenance,
  GenerationBrief,
  ShortCandidate,
} from "@/src/domain/entities";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { GenerationBriefRepository } from "@/src/ports/generation-brief-repository";
import type { IdPort } from "@/src/ports/id";
import type { LlmPort } from "@/src/ports/llm";
import type { Logger } from "@/src/ports/logger";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { TtsPort } from "@/src/ports/tts";

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
      const response = await deps.llm.complete({
        system:
          "Create concise Italian YouTube Shorts ideas for a motorsport channel. Each script must open with its hook and fit within 60 seconds.",
        user: `Channel ID: ${channelId}\nCreate exactly ${count} distinct ideas with metadata and a shot-by-shot B-roll plan.`,
        jsonSchema: responseJsonSchema,
      });
      const ideas = ideationSchema.parse(JSON.parse(response)).ideas.slice(
        0,
        count,
      );
      const created: ShortCandidate[] = [];
      let brollOffset = 0;

      for (const idea of ideas) {
        const createdAt = deps.clock.now();
        const briefId = deps.id.generate();
        const candidateId = deps.id.generate();
        const planLength =
          brollFiles.length === 0 ? idea.brollPlan.length : Math.max(1, idea.brollPlan.length);
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
          await assemblePreview(
            deps,
            candidate,
            brief,
            brollFiles,
            brollOffset,
          ),
        );
        brollOffset += Math.max(planLength, 1);
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
