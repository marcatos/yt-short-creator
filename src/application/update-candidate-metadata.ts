import type { ShortCandidate } from "@/src/domain/entities";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { Logger } from "@/src/ports/logger";

type Dependencies = {
  candidates: CandidateRepository;
  clock: ClockPort;
  logger: Logger;
};

export type UpdateCandidateMetadata = (input: {
  candidateId: string;
  title: string;
  description: string;
  tags: string[];
  scheduledAt: Date | null;
}) => Promise<ShortCandidate>;

export function createUpdateCandidateMetadata(
  deps: Dependencies,
): UpdateCandidateMetadata {
  const log = deps.logger.child({ operation: "updateCandidateMetadata" });
  return async ({ candidateId, title, description, tags, scheduledAt }) => {
    const startedAt = performance.now();
    log.info("Candidate metadata update started", { candidateId });
    try {
      const candidate = await deps.candidates.getById(candidateId);
      if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
      if (!["proposed", "revising"].includes(candidate.status)) {
        throw new Error(`Candidate metadata is locked in status "${candidate.status}"`);
      }
      const trimmedTitle = title.trim();
      if (!trimmedTitle) throw new Error("Candidate title must not be empty");
      const updated: ShortCandidate = {
        ...candidate,
        title: trimmedTitle,
        description: description.trim(),
        tags: [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))],
        scheduledAt,
        updatedAt: deps.clock.now(),
      };
      await deps.candidates.save(updated);
      log.info("Candidate metadata updated", {
        candidateId,
        tagCount: updated.tags.length,
        scheduled: scheduledAt !== null,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return updated;
    } catch (error) {
      log.error("Candidate metadata update failed", {
        candidateId,
        durationMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      });
      throw error;
    }
  };
}
