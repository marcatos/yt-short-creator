import { applyCandidateEvent } from "@/src/domain/approval";
import type { PublishJob } from "@/src/domain/entities";
import { withFullVideoLink } from "@/src/domain/full-video-link";
import { isJobCancelledError, isJobPausedError } from "@/src/domain/queue-control";
import { uploadOrDeferDailyLimit } from "@/src/application/defer-youtube-upload";
import { youtubeUploadCircuitBreaker } from "@/src/application/youtube-upload-circuit-breaker";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { JobRepository } from "@/src/ports/job-repository";
import type { InspectableJobQueue } from "@/src/ports/job-queue";
import type { Logger } from "@/src/ports/logger";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";
import type { SettingsRepository } from "@/src/ports/settings-repository";
import type { SourceVideoRepository } from "@/src/ports/source-video-repository";
import type { YouTubeAuthPort } from "@/src/ports/youtube-auth";
import type { YouTubeCaptionsPort } from "@/src/ports/youtube-captions";
import type { YouTubeUploadPort } from "@/src/ports/youtube-upload";

import { requireStringPayload } from "./handler-utils";
import type { JobHandler } from "./job-handler-context";
import {
  createPublishVoiceOverShortHandler,
  hasVoiceOverPublishPayload,
  type YoutubePublishDeferQueue,
} from "./publish-vo-short-handler";
import { runStep } from "./run-step";
import { currentYouTubeAccessToken } from "./youtube-access-token";

type Dependencies = {
  logger: Logger;
  candidates: CandidateRepository;
  jobs: JobRepository;
  queue: InspectableJobQueue & Partial<YoutubePublishDeferQueue>;
  settings: SettingsRepository;
  auth: YouTubeAuthPort;
  upload: YouTubeUploadPort;
  captions?: YouTubeCaptionsPort;
  clock: ClockPort;
  sourceVideos: SourceVideoRepository;
  replaySessions?: ReplaySessionRepository;
  mediaStore?: MediaStorePort;
};

const JOB_TYPE = "publish_short";

export function createPublishShortHandler(deps: Dependencies): JobHandler {
  const log = deps.logger.child({ jobType: JOB_TYPE });
  const publishVoiceOver = createPublishVoiceOverShortHandler(deps);
  return async (ctx) => {
    const candidateId = requireStringPayload(ctx.payload, "candidateId");
    if (hasVoiceOverPublishPayload(ctx.payload)) {
      await publishVoiceOver(ctx);
      return;
    }
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

    if (
      candidate.status === "published" ||
      (existingJob?.status === "succeeded" && existingJob.youtubeVideoId)
    ) {
      youtubeVideoId = existingJob?.youtubeVideoId ?? undefined;
      await runStep(ctx, JOB_TYPE, "upload", async () => {});
      ctx.setProgress(
        100,
        youtubeVideoId ? `Published as ${youtubeVideoId}` : "Already published",
      );
      log.info("Publish upload skipped", {
        jobId: ctx.jobId,
        candidateId,
        youtubeVideoId,
        reason:
          candidate.status === "published"
            ? "candidate_already_published"
            : "publish_job_already_succeeded",
        durationMs: Math.round(performance.now() - startedAt),
      });
      return;
    }

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
        accessToken = await currentYouTubeAccessToken(
          deps.auth,
          deps.clock.now(),
        );
      });

      await runStep(ctx, JOB_TYPE, "upload", async () => {
        const renderOutputPath = candidate.renderOutputPath;
        if (!renderOutputPath) {
          throw new Error(`Candidate has no render output: ${candidateId}`);
        }
        const token =
          accessToken ??
          (await currentYouTubeAccessToken(deps.auth, deps.clock.now()));
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
        const result = await uploadOrDeferDailyLimit(
          {
            queue: deps.queue,
            breaker: youtubeUploadCircuitBreaker,
            logger: log,
          },
          { jobId: ctx.jobId, jobType: JOB_TYPE },
          () =>
            deps.upload.upload({
              accessToken: token,
              filePath: renderOutputPath,
              title: candidate.title,
              description,
              tags: candidate.tags,
              scheduledAt,
              privacy: scheduledAt ? "private" : settings.defaultPrivacy,
              contentKind: "short",
            }),
        );
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
      if (isJobPausedError(error)) {
        // Pausing must not release the candidate: it stays in "publishing"
        // so resume can continue the same in-flight upload.
        log.info("Publish paused", { jobId: ctx.jobId, candidateId });
        throw error;
      }
      if (isJobCancelledError(error)) {
        // Cancellation is terminal, so the candidate and job row must both
        // be marked failed: this lets retry work and keeps orphan repair
        // (recoverQueue) from re-enqueuing work the user explicitly cancelled.
        if (candidate.status === "publishing") {
          await deps.candidates.save(
            applyCandidateEvent(candidate, { type: "publish_failed" }),
          );
        }
        await saveJob("failed", null, null);
        log.info("Publish cancelled", { jobId: ctx.jobId, candidateId });
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
