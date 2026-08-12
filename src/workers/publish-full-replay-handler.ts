import type { YoutubePrivacy } from "@/src/domain/entities";
import { isJobCancelledError, isJobPausedError } from "@/src/domain/queue-control";
import type { ClockPort } from "@/src/ports/clock";
import type { FullVideoEncodePort } from "@/src/ports/full-video-encode";
import type { Logger } from "@/src/ports/logger";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";
import type { YouTubeAuthPort } from "@/src/ports/youtube-auth";
import type { YouTubeUploadPort } from "@/src/ports/youtube-upload";

import { requireStringPayload } from "./handler-utils";
import type { JobHandler } from "./job-handler-context";
import { runStep } from "./run-step";

type Dependencies = {
  logger: Logger;
  replaySessions: ReplaySessionRepository;
  mediaStore: MediaStorePort;
  fullVideoEncode: FullVideoEncodePort;
  auth: YouTubeAuthPort;
  upload: YouTubeUploadPort;
  clock: ClockPort;
};

const JOB_TYPE = "publish_full_replay";

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

function asPrivacy(value: unknown): YoutubePrivacy {
  if (value === "public" || value === "private" || value === "unlisted") {
    return value;
  }
  return "unlisted";
}

export function createPublishFullReplayHandler(
  deps: Dependencies,
): JobHandler {
  const log = deps.logger.child({ component: "PublishFullReplayHandler" });

  return async (ctx) => {
    const sessionId = requireStringPayload(ctx.payload, "sessionId");
    const privacy = asPrivacy(ctx.payload.privacy);
    const startedAt = performance.now();
    log.info("publish_full_replay started", { jobId: ctx.jobId, sessionId, privacy });

    try {
      let encodePath = "";

      await runStep(ctx, JOB_TYPE, "encode", async () => {
        const session = await deps.replaySessions.getById(sessionId);
        if (!session?.mediaPath) {
          throw new Error(`Replay media missing for session ${sessionId}`);
        }
        ctx.setProgress(5, "Encoding full race for YouTube delivery");
        const outputPath = deps.mediaStore.fullReplayEncodePath(sessionId);
        const result = await deps.fullVideoEncode.encode({
          sourceMediaPath: session.mediaPath,
          outputPath,
        });
        encodePath = result.outputPath;
        await deps.replaySessions.save({
          ...session,
          fullVideoEncodePath: encodePath,
          fullVideoPrivacy: privacy,
          updatedAt: deps.clock.now(),
        });
        ctx.setProgress(
          55,
          result.reused
            ? `Reused encode (${result.encoderLabel}, ~${result.videoBitrateMbps} Mbps)`
            : `Encoded with ${result.encoderLabel} @ ~${result.videoBitrateMbps} Mbps`,
        );
        log.info("Full replay encode step done", {
          sessionId,
          reused: result.reused,
          encoderLabel: result.encoderLabel,
          outputPath: encodePath,
        });
      });

      await runStep(ctx, JOB_TYPE, "upload", async () => {
        const session = await deps.replaySessions.getById(sessionId);
        if (!session) throw new Error(`Replay session not found: ${sessionId}`);
        const packageMeta = session.racePackage?.fullVideo;
        if (!packageMeta?.title) {
          throw new Error("Missing racePackage.fullVideo metadata");
        }
        const filePath = encodePath || session.fullVideoEncodePath;
        if (!filePath) {
          throw new Error("Missing full-video encode path");
        }

        if (session.fullVideoYoutubeId) {
          ctx.setProgress(
            100,
            `Already on YouTube as ${session.fullVideoYoutubeId}`,
          );
          log.info("Full replay upload skipped (already published)", {
            sessionId,
            youtubeVideoId: session.fullVideoYoutubeId,
          });
          return;
        }

        ctx.setProgress(60, "Uploading full race to YouTube");
        const accessToken = await currentAccessToken(
          deps.auth,
          deps.clock.now(),
        );
        const description = [
          packageMeta.description,
          "",
          session.racePackage?.transcript
            ? `---\nTranscript di gara\n${session.racePackage.transcript}`
            : null,
        ]
          .filter(Boolean)
          .join("\n");

        const result = await deps.upload.upload({
          accessToken,
          filePath,
          title: packageMeta.title.slice(0, 100),
          description,
          tags: packageMeta.tags.slice(0, 15),
          scheduledAt: null,
          privacy,
          contentKind: "full",
        });

        await deps.replaySessions.save({
          ...session,
          fullVideoEncodePath: filePath,
          fullVideoYoutubeId: result.youtubeVideoId,
          fullVideoPrivacy: privacy,
          fullVideoPublishedAt: deps.clock.now(),
          updatedAt: deps.clock.now(),
        });
        ctx.setProgress(100, `Uploaded ${result.youtubeVideoId}`);
        log.info("Full replay uploaded", {
          sessionId,
          youtubeVideoId: result.youtubeVideoId,
          privacy,
        });
      });

      log.info("publish_full_replay completed", {
        jobId: ctx.jobId,
        sessionId,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      if (isJobPausedError(error) || isJobCancelledError(error)) {
        throw error;
      }
      log.error("publish_full_replay failed", {
        jobId: ctx.jobId,
        sessionId,
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
