import type { VoiceOverPackage } from "@/src/domain/voice-over";
import { resolveItalianReelSource } from "@/src/domain/reel-publish-source";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { DurableJobQueue } from "@/src/ports/job-queue";
import type { InstagramAuthPort } from "@/src/ports/instagram-auth";
import type { JobRepository } from "@/src/ports/job-repository";
import type { Logger } from "@/src/ports/logger";
import { isInstagramConnected } from "@/src/workers/instagram-access-token";

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

/** Shared state for the per-language fan-outs below. */
type FanOut = {
  queue: DurableJobQueue;
  activeJobs: Set<string>;
  logger: Logger;
};

/**
 * Rendering only fans out per language once both narrations exist: a partial
 * set still belongs to the single-render path that produced it.
 */
function isBilingual(voiceOvers: readonly VoiceOverPackage[]): boolean {
  const languages = new Set(voiceOvers.map(({ language }) => language));
  return languages.has("it") && languages.has("en");
}

/**
 * Re-renders only the languages still missing their narrated cut. A generic
 * render_short would render one language and never fan out the publish pair,
 * so VO candidates never fall through to generic recovery.
 */
async function enqueueVoiceOverRenders(
  fanOut: FanOut,
  candidateId: string,
  voiceOvers: readonly VoiceOverPackage[],
): Promise<number> {
  let localizedJobs = 0;
  for (const voiceOver of voiceOvers) {
    if (voiceOver.renderOutputPath) continue;
    const payload = { candidateId, language: voiceOver.language };
    const activeKey = activeJobKey("render_short", payload);
    if (fanOut.activeJobs.has(activeKey)) continue;
    await fanOut.queue.enqueue({ type: "render_short", payload });
    fanOut.activeJobs.add(activeKey);
    localizedJobs += 1;
  }
  if (localizedJobs > 0) {
    fanOut.logger.warn("Repaired orphan voice-over render jobs", {
      candidateId,
      localizedJobs,
    });
  }
  return localizedJobs;
}

/** Re-publishes only the languages whose captions never reached YouTube. */
async function enqueueVoiceOverPublishes(
  fanOut: FanOut,
  candidateId: string,
  voiceOvers: readonly VoiceOverPackage[],
): Promise<number> {
  let localizedJobs = 0;
  for (const voiceOver of voiceOvers) {
    if (voiceOver.youtubeCaptionId) continue;
    if (!voiceOver.renderOutputPath || !voiceOver.srtPath) {
      fanOut.logger.warn("Skipped incomplete voice-over recovery package", {
        candidateId,
        language: voiceOver.language,
        hasRender: Boolean(voiceOver.renderOutputPath),
        hasSrt: Boolean(voiceOver.srtPath),
      });
      continue;
    }
    const payload = {
      candidateId,
      language: voiceOver.language,
      filePath: voiceOver.renderOutputPath,
      srtPath: voiceOver.srtPath,
      title: voiceOver.title,
      description: voiceOver.description,
    };
    const activeKey = activeJobKey("publish_short", payload);
    if (fanOut.activeJobs.has(activeKey)) continue;
    await fanOut.queue.enqueue({ type: "publish_short", payload });
    fanOut.activeJobs.add(activeKey);
    localizedJobs += 1;
  }
  if (localizedJobs > 0) {
    fanOut.logger.warn("Repaired orphan voice-over publish jobs", {
      candidateId,
      localizedJobs,
    });
  }
  return localizedJobs;
}

export function createRecoverQueue(deps: {
  queue: DurableJobQueue;
  candidates: CandidateRepository;
  jobs?: JobRepository;
  instagramAuth?: InstagramAuthPort;
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
      const fanOut: FanOut = { queue: deps.queue, activeJobs, logger };
      const candidates = await deps.candidates.list({});
      let repairedCandidates = 0;
      const instagramConnected =
        deps.instagramAuth && deps.jobs
          ? await isInstagramConnected(deps.instagramAuth)
          : false;

      for (const candidate of candidates) {
        if (
          candidate.status !== "rendering" &&
          candidate.status !== "publishing"
        ) {
          continue;
        }

        const voiceOvers = candidate.voiceOvers ?? [];
        if (candidate.status === "rendering" && isBilingual(voiceOvers)) {
          const localizedJobs = await enqueueVoiceOverRenders(
            fanOut,
            candidate.id,
            voiceOvers,
          );
          if (localizedJobs > 0) repairedCandidates += 1;
          continue;
        }
        if (candidate.status === "publishing" && voiceOvers.length > 0) {
          const localizedJobs = await enqueueVoiceOverPublishes(
            fanOut,
            candidate.id,
            voiceOvers,
          );
          if (localizedJobs > 0) repairedCandidates += 1;
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

      if (instagramConnected && deps.jobs) {
        for (const candidate of candidates) {
          if (!resolveItalianReelSource(candidate)) continue;
          const igJob = await deps.jobs.getInstagramPublishJobByCandidateId(
            candidate.id,
          );
          if (igJob?.status === "succeeded") continue;
          const activeKey = activeJobKey("publish_reel", {
            candidateId: candidate.id,
          });
          if (activeJobs.has(activeKey)) continue;
          await deps.queue.enqueue({
            type: "publish_reel",
            payload: { candidateId: candidate.id },
          });
          activeJobs.add(activeKey);
          repairedCandidates += 1;
          logger.warn("Repaired orphan Instagram Reel publish job", {
            candidateId: candidate.id,
            priorInstagramJobStatus: igJob?.status ?? null,
          });
        }
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
