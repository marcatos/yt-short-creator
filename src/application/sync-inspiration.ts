import type { ClockPort } from "@/src/ports/clock";
import type { IdPort } from "@/src/ports/id";
import type {
  InspirationIdeaRecord,
  InspirationStorePort,
  InspirationSyncRun,
  InspirationSyncSource,
  InspirationSyncStatus,
} from "@/src/ports/inspiration-store";
import type { Logger } from "@/src/ports/logger";
import type {
  CapturedInspirationIdea,
  YouTubeStudioInspirationPort,
} from "@/src/ports/youtube-studio-inspiration";

export type SyncRunSummary = {
  id: string;
  status: InspirationSyncStatus;
  ideaCount: number;
  source: InspirationSyncSource;
  errorMessage: string | null;
};

export type SyncInspiration = {
  run(input: { source: InspirationSyncSource }): Promise<SyncRunSummary>;
};

type SyncInspirationDependencies = {
  studio: YouTubeStudioInspirationPort;
  store: InspirationStorePort;
  id: IdPort;
  clock: ClockPort;
  logger: Logger;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorMeta(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { error: String(error) };
}

function toIdeaRecord(
  syncRunId: string,
  idea: CapturedInspirationIdea,
  id: string,
  capturedAt: Date,
): InspirationIdeaRecord {
  return {
    id,
    syncRunId,
    externalKey: idea.externalKey,
    title: idea.title,
    summary: idea.summary,
    audienceInterest: idea.audienceInterest,
    channelAlignment: idea.channelAlignment,
    relatedInterest: idea.relatedInterest,
    outline: idea.outline,
    suggestedTitles: idea.suggestedTitles,
    thumbnailNotes: idea.thumbnailNotes,
    rawSnippet: idea.rawSnippet,
    capturedAt,
    active: true,
  };
}

export function createSyncInspiration(
  deps: SyncInspirationDependencies,
): SyncInspiration {
  const log = deps.logger.child({ operation: "syncInspiration" });

  return {
    async run({ source }): Promise<SyncRunSummary> {
      const startedMs = performance.now();
      const runId = deps.id.generate();
      const startedAt = deps.clock.now();
      const draft: InspirationSyncRun = {
        id: runId,
        startedAt,
        finishedAt: null,
        status: "failed",
        ideaCount: 0,
        errorMessage: null,
        source,
      };

      log.info("Inspiration sync started", { runId, source });
      await deps.store.saveSyncRun(draft);

      try {
        const captureStartedMs = performance.now();
        const capture = await deps.studio.sync();
        log.info("Studio inspiration capture completed", {
          runId,
          source,
          status: capture.status,
          ideaCount: capture.ideas.length,
          durationMs: Math.round(performance.now() - captureStartedMs),
        });

        const capturedAt = deps.clock.now();
        const ideas = capture.ideas.map((idea) =>
          toIdeaRecord(runId, idea, deps.id.generate(), capturedAt),
        );
        await deps.store.replaceActiveIdeas(runId, ideas);

        const summary: SyncRunSummary = {
          id: runId,
          status: capture.status,
          ideaCount: ideas.length,
          source,
          errorMessage: null,
        };
        await deps.store.saveSyncRun({
          ...draft,
          finishedAt: deps.clock.now(),
          status: summary.status,
          ideaCount: summary.ideaCount,
          errorMessage: null,
        });
        log.info("Inspiration sync completed", {
          runId,
          source,
          status: summary.status,
          ideaCount: summary.ideaCount,
          durationMs: Math.round(performance.now() - startedMs),
        });
        return summary;
      } catch (error) {
        const message = errorMessage(error);
        await deps.store.saveSyncRun({
          ...draft,
          finishedAt: deps.clock.now(),
          status: "failed",
          ideaCount: 0,
          errorMessage: message,
        });
        log.error("Inspiration sync failed", {
          runId,
          source,
          error: errorMeta(error),
          durationMs: Math.round(performance.now() - startedMs),
        });
        throw error;
      }
    },
  };
}
