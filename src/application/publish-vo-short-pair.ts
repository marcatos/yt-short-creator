import type { VoiceOverLanguage, VoiceOverPackage } from "@/src/domain/voice-over";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { InspectableJobQueue } from "@/src/ports/job-queue";
import type { Logger } from "@/src/ports/logger";

type Dependencies = {
  candidates: CandidateRepository;
  queue: InspectableJobQueue;
  logger: Logger;
};

export type PublishVoShortPair = (input: {
  candidateId: string;
}) => Promise<string[]>;

const LANGUAGES: VoiceOverLanguage[] = ["it", "en"];
const ACTIVE_STATUSES = new Set(["queued", "running", "paused", "succeeded"]);

function requirePackage(
  packages: VoiceOverPackage[],
  candidateId: string,
  language: VoiceOverLanguage,
): VoiceOverPackage {
  const voiceOver = packages.find((item) => item.language === language);
  if (!voiceOver) {
    throw new Error(
      `Voice-over package "${language}" not found for candidate: ${candidateId}`,
    );
  }
  if (!voiceOver.renderOutputPath) {
    throw new Error(
      `Voice-over render output "${language}" not found for candidate: ${candidateId}`,
    );
  }
  if (!voiceOver.srtPath) {
    throw new Error(
      `Voice-over SRT "${language}" not found for candidate: ${candidateId}`,
    );
  }
  return voiceOver;
}

export function createPublishVoShortPair(
  deps: Dependencies,
): PublishVoShortPair {
  const log = deps.logger.child({ operation: "publishVoShortPair" });

  return async ({ candidateId }) => {
    const startedAt = performance.now();
    log.info("Voice-over Short pair enqueue started", { candidateId });
    try {
      const candidate = await deps.candidates.getById(candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }
      const packages = candidate.voiceOvers ?? [];
      const localized = LANGUAGES.map((language) =>
        requirePackage(packages, candidateId, language),
      );
      const existingJobs = deps.queue.listJobs();
      const jobIds: string[] = [];
      let enqueuedCount = 0;

      for (const voiceOver of localized) {
        const existing = existingJobs.find(
          (job) =>
            job.type === "publish_short" &&
            job.payload.candidateId === candidateId &&
            job.payload.language === voiceOver.language &&
            ACTIVE_STATUSES.has(job.status),
        );
        if (existing) {
          jobIds.push(existing.id);
          continue;
        }
        const jobId = await deps.queue.enqueue({
          type: "publish_short",
          payload: {
            candidateId,
            language: voiceOver.language,
            filePath: voiceOver.renderOutputPath!,
            srtPath: voiceOver.srtPath!,
            title: voiceOver.title,
            description: voiceOver.description,
          },
        });
        jobIds.push(jobId);
        enqueuedCount += 1;
      }

      log.info("Voice-over Short pair enqueue completed", {
        candidateId,
        jobIds,
        enqueuedCount,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return jobIds;
    } catch (error) {
      log.error("Voice-over Short pair enqueue failed", {
        candidateId,
        durationMs: Math.round(performance.now() - startedAt),
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  };
}
