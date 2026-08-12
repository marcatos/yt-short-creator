import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { DurableJobQueue } from "@/src/ports/job-queue";
import type { Logger } from "@/src/ports/logger";

function activeJobKey(
  type: string,
  payload: Record<string, unknown>,
): string {
  const language =
    payload.language === "it" || payload.language === "en"
      ? `:${payload.language}`
      : "";
  return `${type}:${String(payload.candidateId)}${language}`;
}

export type RecoverQueueResult = {
  requeuedRunning: number;
  repairedCandidates: number;
};

export function createRecoverQueue(deps: {
  queue: DurableJobQueue;
  candidates: CandidateRepository;
  logger: Logger;
}): () => Promise<RecoverQueueResult> {
  const logger = deps.logger.child({ operation: "recoverQueue" });

  return async () => {
    const startedAt = Date.now();
    logger.info("Queue recovery started");

    try {
      const { requeuedRunning } = await deps.queue.recoverOnBoot();
      logger.info("Running job recovery completed", { requeuedRunning });

      const activeJobs = new Set(
        deps.queue
          .listJobs()
          .filter(
            ({ status }) =>
              status === "queued" ||
              status === "running" ||
              status === "paused",
          )
          .map(({ type, payload }) => activeJobKey(type, payload)),
      );
      const candidates = await deps.candidates.list({});
      let repairedCandidates = 0;

      for (const candidate of candidates) {
        if (
          candidate.status !== "rendering" &&
          candidate.status !== "publishing"
        ) {
          continue;
        }

        if (
          candidate.status === "publishing" &&
          candidate.voiceOvers?.length
        ) {
          let localizedJobs = 0;
          for (const voiceOver of candidate.voiceOvers) {
            if (voiceOver.youtubeCaptionId) continue;
            if (!voiceOver.renderOutputPath || !voiceOver.srtPath) {
              logger.warn("Skipped incomplete voice-over recovery package", {
                candidateId: candidate.id,
                language: voiceOver.language,
                hasRender: Boolean(voiceOver.renderOutputPath),
                hasSrt: Boolean(voiceOver.srtPath),
              });
              continue;
            }
            const payload = {
              candidateId: candidate.id,
              language: voiceOver.language,
              filePath: voiceOver.renderOutputPath,
              srtPath: voiceOver.srtPath,
              title: voiceOver.title,
              description: voiceOver.description,
            };
            const activeKey = activeJobKey("publish_short", payload);
            if (activeJobs.has(activeKey)) continue;
            await deps.queue.enqueue({ type: "publish_short", payload });
            activeJobs.add(activeKey);
            localizedJobs += 1;
          }
          if (localizedJobs > 0) {
            repairedCandidates += 1;
            logger.warn("Repaired orphan voice-over publish jobs", {
              candidateId: candidate.id,
              localizedJobs,
            });
          }
          // A generic publish payload cannot identify the localized media and
          // would enter the legacy single-video path, so VO candidates never
          // fall through to generic recovery.
          continue;
        }

        const type =
          candidate.status === "rendering" ? "render_short" : "publish_short";
        const activeKey = activeJobKey(type, { candidateId: candidate.id });
        if (activeJobs.has(activeKey)) {
          continue;
        }

        await deps.queue.enqueue({
          type,
          payload: { candidateId: candidate.id },
        });
        activeJobs.add(activeKey);
        repairedCandidates += 1;
        logger.warn("Repaired orphan candidate with recovery job", {
          candidateId: candidate.id,
          status: candidate.status,
        });
      }

      logger.info("Queue recovery completed", {
        durationMs: Date.now() - startedAt,
        candidatesChecked: candidates.length,
        requeuedRunning,
        repairedCandidates,
      });
      return { requeuedRunning, repairedCandidates };
    } catch (error) {
      logger.error("Queue recovery failed", {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  };
}
