import { applyCandidateEvent } from "@/src/domain/approval";
import type { PublishJob } from "@/src/domain/entities";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { JobRepository } from "@/src/ports/job-repository";
import type { Logger } from "@/src/ports/logger";
import type { YouTubeAuthPort } from "@/src/ports/youtube-auth";
import type { YouTubeUploadPort } from "@/src/ports/youtube-upload";

import type { JobHandler } from "./handlers";

type Dependencies = {
  logger: Logger;
  candidates: CandidateRepository;
  jobs: JobRepository;
  auth: YouTubeAuthPort;
  upload: YouTubeUploadPort;
  clock: ClockPort;
};

async function currentAccessToken(
  auth: YouTubeAuthPort,
  now: Date,
): Promise<string> {
  const tokens = await auth.getStoredTokens();
  if (!tokens) throw new Error("YouTube is not connected");
  if (tokens.expiresAt.getTime() > now.getTime() + 60_000) {
    return tokens.accessToken;
  }
  const refreshed = await auth.refreshAccessToken(tokens.refreshToken);
  await auth.saveTokens({
    ...tokens,
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
  });
  return refreshed.accessToken;
}

export function createPublishShortHandler(deps: Dependencies): JobHandler {
  const log = deps.logger.child({ jobType: "publish_short" });
  return async (ctx) => {
    const candidateId = ctx.payload.candidateId;
    if (typeof candidateId !== "string" || !candidateId) {
      throw new Error("Job payload missing required string field: candidateId");
    }
    const startedAt = performance.now();
    let candidate = await deps.candidates.getById(candidateId);
    if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
    if (candidate.status === "ready") {
      candidate = applyCandidateEvent(candidate, { type: "mark_publishing" });
      await deps.candidates.save(candidate);
    } else if (candidate.status !== "publishing") {
      throw new Error(`Candidate cannot publish in status "${candidate.status}"`);
    }
    if (!candidate.renderOutputPath) {
      throw new Error(`Candidate has no render output: ${candidateId}`);
    }

    const renderOutputPath = candidate.renderOutputPath;
    const scheduledAt = candidate.scheduledAt;
    const existingJob = await deps.jobs.getPublishJobByCandidateId(candidateId);
    const publishJobId = existingJob?.id ?? ctx.jobId;
    const createdAt = existingJob?.createdAt ?? deps.clock.now();
    const saveJob = async (
      status: PublishJob["status"],
      youtubeVideoId: string | null,
      publishedAt: Date | null,
    ) => {
      await deps.jobs.savePublishJob({
        id: publishJobId,
        candidateId,
        status,
        youtubeVideoId,
        uploadSessionUrl: null,
        scheduledAt,
        publishedAt,
        createdAt,
        updatedAt: deps.clock.now(),
      });
    };

    log.info("Publish started", {
      jobId: ctx.jobId,
      candidateId,
      scheduled: scheduledAt !== null,
    });
    ctx.setProgress(5, "Preparing YouTube upload");
    await saveJob("running", null, null);

    try {
      const accessToken = await currentAccessToken(deps.auth, deps.clock.now());
      ctx.setProgress(20, "Uploading Short to YouTube");
      const result = await deps.upload.upload({
        accessToken,
        filePath: renderOutputPath,
        title: candidate.title,
        description: candidate.description,
        tags: candidate.tags,
        scheduledAt,
        privacy: scheduledAt ? "private" : "public",
      });
      const publishedAt = deps.clock.now();
      candidate = applyCandidateEvent(candidate, { type: "publish_succeeded" });
      await deps.candidates.save(candidate);
      await saveJob("succeeded", result.youtubeVideoId, publishedAt);
      ctx.setProgress(100, `Published as ${result.youtubeVideoId}`);
      log.info("Publish completed", {
        jobId: ctx.jobId,
        candidateId,
        youtubeVideoId: result.youtubeVideoId,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      if (candidate.status === "publishing") {
        await deps.candidates.save(
          applyCandidateEvent(candidate, { type: "publish_failed" }),
        );
      }
      await saveJob("failed", null, null);
      log.error("Publish failed", {
        jobId: ctx.jobId,
        candidateId,
        durationMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.stack : String(error),
      });
      throw error;
    }
  };
}
