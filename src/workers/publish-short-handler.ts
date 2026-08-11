import { applyCandidateEvent } from "@/src/domain/approval";
import type { PublishJob } from "@/src/domain/entities";
import { withFullVideoLink } from "@/src/domain/full-video-link";
import { isJobCancelledError, isJobPausedError } from "@/src/domain/queue-control";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { JobRepository } from "@/src/ports/job-repository";
import type { Logger } from "@/src/ports/logger";
import type { SettingsRepository } from "@/src/ports/settings-repository";
import type { SourceVideoRepository } from "@/src/ports/source-video-repository";
import type { YouTubeAuthPort } from "@/src/ports/youtube-auth";
import type { YouTubeUploadPort } from "@/src/ports/youtube-upload";

import { requireStringPayload } from "./handler-utils";
import type { JobHandler } from "./job-handler-context";
import { runStep } from "./run-step";

type Dependencies = {
  logger: Logger;
  candidates: CandidateRepository;
  jobs: JobRepository;
  settings: SettingsRepository;
  auth: YouTubeAuthPort;
  upload: YouTubeUploadPort;
  clock: ClockPort;
  sourceVideos: SourceVideoRepository;
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

const JOB_TYPE = "publish_short";

export function createPublishShortHandler(deps: Dependencies): JobHandler {
  const log = deps.logger.child({ jobType: JOB_TYPE });
  return async (ctx) => {
    const candidateId = requireStringPayload(ctx.payload, "candidateId");
    const startedAt = performance.now();
    const found = await deps.candidates.getById(candidateId);
    if (!found) throw new Error(`Candidate not found: ${candidateId}`);
    let candidate = found;

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

    let accessToken: string | undefined;
    let youtubeVideoId: string | undefined;

    try {
      await runStep(ctx, JOB_TYPE, "prepare", async () => {
        if (candidate.status === "ready") {
          candidate = applyCandidateEvent(candidate, { type: "mark_publishing" });
          await deps.candidates.save(candidate);
        } else if (candidate.status !== "publishing") {
          throw new Error(`Candidate cannot publish in status "${candidate.status}"`);
        }
        if (!candidate.renderOutputPath) {
          throw new Error(`Candidate has no render output: ${candidateId}`);
        }
        ctx.setProgress(5, "Preparing YouTube upload");
        await saveJob("running", null, null);
        accessToken = await currentAccessToken(deps.auth, deps.clock.now());
      });

      await runStep(ctx, JOB_TYPE, "upload", async () => {
        const renderOutputPath = candidate.renderOutputPath;
        if (!renderOutputPath) {
          throw new Error(`Candidate has no render output: ${candidateId}`);
        }
        const token =
          accessToken ?? (await currentAccessToken(deps.auth, deps.clock.now()));
        const settings = await deps.settings.get();
        let description = candidate.description;
        if (
          candidate.origin === "clip" &&
          "sourceVideoId" in candidate.provenance
        ) {
          const source = await deps.sourceVideos.getById(
            candidate.provenance.sourceVideoId,
          );
          if (source?.youtubeVideoId) {
            description = withFullVideoLink(
              description,
              source.youtubeVideoId,
            );
          }
        }
        ctx.setProgress(20, "Uploading Short to YouTube");
        const result = await deps.upload.upload({
          accessToken: token,
          filePath: renderOutputPath,
          title: candidate.title,
          description,
          tags: candidate.tags,
          scheduledAt,
          privacy: scheduledAt ? "private" : settings.defaultPrivacy,
        });
        youtubeVideoId = result.youtubeVideoId;
        const publishedAt = deps.clock.now();
        candidate = applyCandidateEvent(candidate, { type: "publish_succeeded" });
        await deps.candidates.save(candidate);
        await saveJob("succeeded", result.youtubeVideoId, publishedAt);
        ctx.setProgress(100, `Published as ${result.youtubeVideoId}`);
      });

      log.info("Publish completed", {
        jobId: ctx.jobId,
        candidateId,
        youtubeVideoId,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      if (isJobPausedError(error) || isJobCancelledError(error)) {
        log.info("Publish interrupted", {
          jobId: ctx.jobId,
          candidateId,
          reason: isJobPausedError(error) ? "paused" : "cancelled",
        });
        throw error;
      }
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
