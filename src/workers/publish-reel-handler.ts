import { assembleReelCaption } from "@/src/domain/reel-caption";
import { resolveItalianReelSource } from "@/src/domain/reel-publish-source";
import type { InstagramPublishJob } from "@/src/domain/entities";
import { resolveYoutubeChannelUrl } from "@/src/application/enqueue-instagram-reel";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { ChannelRepository } from "@/src/ports/channel-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { InstagramAuthPort } from "@/src/ports/instagram-auth";
import type { InstagramReelsPort } from "@/src/ports/instagram-reels";
import type { JobRepository } from "@/src/ports/job-repository";
import type { Logger } from "@/src/ports/logger";
import type { SettingsRepository } from "@/src/ports/settings-repository";
import { isJobCancelledError, isJobPausedError } from "@/src/domain/queue-control";

import { requireStringPayload } from "./handler-utils";
import type { JobHandler } from "./job-handler-context";
import { runStep } from "./run-step";
import { currentInstagramAccessToken } from "./instagram-access-token";

type Dependencies = {
  logger: Logger;
  candidates: CandidateRepository;
  channels: ChannelRepository;
  jobs: JobRepository;
  settings: SettingsRepository;
  instagramAuth: InstagramAuthPort;
  instagramReels: InstagramReelsPort;
  clock: ClockPort;
};

const JOB_TYPE = "publish_reel";

export function createPublishReelHandler(deps: Dependencies): JobHandler {
  const log = deps.logger.child({ jobType: JOB_TYPE });

  return async (ctx) => {
    const candidateId = requireStringPayload(ctx.payload, "candidateId");
    const startedAt = performance.now();
    const candidate = await deps.candidates.getById(candidateId);
    if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);

    const existingJob =
      await deps.jobs.getInstagramPublishJobByCandidateId(candidateId);
    const publishJobId = existingJob?.id ?? ctx.jobId;
    const createdAt = existingJob?.createdAt ?? deps.clock.now();

    const saveJob = async (
      status: InstagramPublishJob["status"],
      fields: Partial<
        Pick<
          InstagramPublishJob,
          | "instagramMediaId"
          | "permalink"
          | "caption"
          | "error"
          | "publishedAt"
        >
      >,
    ) => {
      await deps.jobs.saveInstagramPublishJob({
        id: publishJobId,
        candidateId,
        status,
        instagramMediaId: fields.instagramMediaId ?? existingJob?.instagramMediaId ?? null,
        permalink: fields.permalink ?? existingJob?.permalink ?? null,
        caption: fields.caption ?? existingJob?.caption ?? null,
        error: fields.error ?? existingJob?.error ?? null,
        publishedAt: fields.publishedAt ?? existingJob?.publishedAt ?? null,
        createdAt,
        updatedAt: deps.clock.now(),
      });
    };

    if (
      existingJob?.status === "succeeded" &&
      existingJob.instagramMediaId
    ) {
      await runStep(ctx, JOB_TYPE, "publish", async () => {});
      ctx.setProgress(
        100,
        existingJob.permalink
          ? `Reel posted: ${existingJob.permalink}`
          : `Reel posted (${existingJob.instagramMediaId})`,
      );
      log.info("publish_reel skipped — already succeeded", {
        jobId: ctx.jobId,
        candidateId,
        instagramMediaId: existingJob.instagramMediaId,
      });
      return;
    }

    log.info("publish_reel started", { jobId: ctx.jobId, candidateId });

    let caption = "";
    let filePath = "";
    let accessToken = "";
    let igUserId = "";

    try {
      await runStep(ctx, JOB_TYPE, "prepare", async () => {
        const source = resolveItalianReelSource(candidate);
        if (!source) {
          throw new Error(
            "Italian render output is not ready for Instagram publish",
          );
        }
        filePath = source.filePath;

        const [settings, channels, auth] = await Promise.all([
          deps.settings.get(),
          deps.channels.list(),
          currentInstagramAccessToken(deps.instagramAuth, deps.clock.now()),
        ]);
        accessToken = auth.accessToken;
        igUserId = auth.igUserId;

        caption = assembleReelCaption({
          title: source.title,
          description: source.description,
          youtubeChannelUrl: resolveYoutubeChannelUrl(
            channels[0] ?? null,
            settings.youtubeChannelUrlOverride,
          ),
          hashtags: settings.instagramDefaultHashtags,
        });

        await saveJob("running", { caption, error: null });
        ctx.setProgress(10, "Prepared Reel caption and media");
      });

      let publishedResult: { mediaId: string; permalink: string | null } | undefined;

      await runStep(ctx, JOB_TYPE, "upload", async () => {
        const settings = await deps.settings.get();
        ctx.setProgress(35, "Uploading Reel to Instagram");
        publishedResult = await deps.instagramReels.publishReel({
          igUserId,
          accessToken,
          filePath,
          caption,
          shareToFeed: settings.instagramShareToFeed,
        });
        await saveJob("running", {
          caption,
          instagramMediaId: publishedResult.mediaId,
          permalink: publishedResult.permalink,
        });
        await ctx.saveCheckpoint("upload", publishedResult);
      });

      if (!publishedResult) {
        const checkpointData = ctx.checkpoint?.data as
          | { mediaId: string; permalink: string | null }
          | undefined;
        if (checkpointData?.mediaId) {
          publishedResult = checkpointData;
        }
      }

      await runStep(ctx, JOB_TYPE, "poll", async () => {
        ctx.setProgress(75, "Finalizing Reel on Instagram");
      });

      await runStep(ctx, JOB_TYPE, "publish", async () => {
        if (!publishedResult?.mediaId) {
          throw new Error("Instagram publish did not produce a media id");
        }
        await saveJob("succeeded", {
          instagramMediaId: publishedResult.mediaId,
          permalink: publishedResult.permalink,
          caption,
          error: null,
          publishedAt: deps.clock.now(),
        });
        ctx.setProgress(
          100,
          publishedResult.permalink
            ? `Reel posted: ${publishedResult.permalink}`
            : `Reel posted (${publishedResult.mediaId})`,
        );
      });

      log.info("publish_reel completed", {
        jobId: ctx.jobId,
        candidateId,
        instagramMediaId: publishedResult?.mediaId,
        permalink: publishedResult?.permalink,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      if (isJobPausedError(error) || isJobCancelledError(error)) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : "Instagram publish failed";
      await saveJob("failed", { error: message, caption: caption || null });
      log.error("publish_reel failed", {
        jobId: ctx.jobId,
        candidateId,
        durationMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.stack : String(error),
      });
      throw error;
    }
  };
}
