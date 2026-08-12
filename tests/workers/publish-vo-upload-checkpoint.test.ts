import { describe, expect, it } from "vitest";

import type { ShortCandidate } from "@/src/domain/entities";
import type { JobCheckpoint } from "@/src/domain/queue-control";
import type { Logger } from "@/src/ports/logger";
import type { JobHandlerContext } from "@/src/workers/job-handler-context";
import { createPublishShortHandler } from "@/src/workers/publish-short-handler";

const now = new Date("2026-08-12T10:00:00.000Z");

function logger(): Logger {
  const instance: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child: () => instance,
  };
  return instance;
}

function candidate(): ShortCandidate {
  return {
    id: "candidate-42",
    origin: "replay",
    status: "ready",
    title: "Fallback title",
    description: "Fallback description",
    tags: ["simracing"],
    score: 0.96,
    provenance: {
      replaySessionId: "replay-1",
      startMs: 10_000,
      endMs: 28_000,
      hookReason: "Late braking pass",
      eventType: "overtake",
      crop: { mode: "center_vertical", focusX: 0.5 },
    },
    renderOutputPath: null,
    voiceOvers: [
      {
        language: "it",
        script: "Sorpasso decisivo.",
        title: "Sorpasso all'ultimo giro",
        description: "La staccata decisiva.",
        voiceProfile: "coral",
        audioPath: "media/voice/vo-it.mp3",
        words: [],
        srtPath: "media/voice/vo-it.srt",
        assPath: "media/voice/vo-it.ass",
        scriptHash: "it-hash",
        renderOutputPath: "media/renders/vo-it.mp4",
      },
    ],
    scheduledAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeContext(
  checkpoint: JobCheckpoint | null,
  saveCheckpoint: JobHandlerContext["saveCheckpoint"],
): JobHandlerContext {
  return {
    jobId: "publish-it",
    payload: {
      candidateId: "candidate-42",
      language: "it",
      filePath: "media/renders/vo-it.mp4",
      srtPath: "media/voice/vo-it.srt",
      title: "Sorpasso all'ultimo giro",
      description: "La staccata decisiva.",
    },
    checkpoint,
    setProgress() {},
    saveCheckpoint,
    signal: new AbortController().signal,
    shouldPause: () => false,
    throwIfPausedOrCancelled() {},
  };
}

function makeHarness(failAt: "video" | "caption") {
  let current = candidate();
  let checkpoint: JobCheckpoint | null = null;
  let failurePending = true;
  let videoUploads = 0;
  let captionUploads = 0;
  const saveCheckpoint = async (step: string, data?: unknown) => {
    checkpoint = data === undefined ? { step } : { step, data };
  };
  const handler = createPublishShortHandler({
    logger: logger(),
    candidates: {
      async save(value) {
        const voiceOver = value.voiceOvers?.[0];
        const reachedFailure =
          failAt === "video"
            ? Boolean(voiceOver?.youtubeVideoId) &&
              !voiceOver?.youtubeCaptionId
            : Boolean(voiceOver?.youtubeCaptionId);
        if (failurePending && reachedFailure) {
          failurePending = false;
          throw new Error(`candidate save failed after ${failAt} upload`);
        }
        current = value;
      },
      getById: async () => current,
      list: async () => [current],
    },
    jobs: {
      saveRenderJob: async () => {},
      savePublishJob: async () => {},
      getRenderJobById: async () => null,
      getPublishJobById: async () => null,
      getRenderJobByCandidateId: async () => null,
      getPublishJobByCandidateId: async () => null,
    },
    settings: {
      get: async () => ({
        brandRoot: "brand",
        logLevel: "INFO",
        defaultPrivacy: "unlisted",
        videoEncoderPreference: "libx264",
        brandVoiceProfile: "coral",
        shortsBurnInCaptions: true,
        fullBurnInCaptions: false,
        voiceDuckDb: -12,
        enableVoiceOverPipeline: true,
      }),
      save: async () => {},
    },
    auth: {
      getAuthorizationUrl: async () => "",
      exchangeCode: async () => {
        throw new Error("unused");
      },
      refreshAccessToken: async () => {
        throw new Error("unused");
      },
      getStoredTokens: async () => ({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(now.getTime() + 3_600_000),
      }),
      saveTokens: async () => {},
    },
    upload: {
      async upload() {
        videoUploads += 1;
        return { youtubeVideoId: "youtube-it" };
      },
    },
    captions: {
      async upload() {
        captionUploads += 1;
        return { youtubeCaptionId: "caption-it" };
      },
    },
    clock: { now: () => now },
    sourceVideos: {
      save: async () => {},
      getById: async () => null,
      getByYoutubeVideoId: async () => null,
      listByChannelId: async () => [],
      upsertMany: async () => {},
    },
  });

  return {
    firstRun: () => handler(makeContext(null, saveCheckpoint)),
    retry: () => handler(makeContext(checkpoint, saveCheckpoint)),
    checkpoint: () => checkpoint,
    current: () => current,
    counts: () => ({ videoUploads, captionUploads }),
  };
}

describe("publish_short VO external upload checkpoints", () => {
  it("does not duplicate video upload when candidate persistence fails", async () => {
    const harness = makeHarness("video");

    await expect(harness.firstRun()).rejects.toThrow(
      "candidate save failed after video upload",
    );
    expect(harness.checkpoint()).toEqual({
      step: "upload",
      data: { language: "it", youtubeVideoId: "youtube-it" },
    });

    await expect(harness.retry()).resolves.toBeUndefined();
    expect(harness.counts()).toEqual({ videoUploads: 1, captionUploads: 1 });
    expect(harness.current().voiceOvers?.[0]).toEqual(
      expect.objectContaining({
        youtubeVideoId: "youtube-it",
        youtubeCaptionId: "caption-it",
      }),
    );
  });

  it("does not duplicate caption upload when candidate persistence fails", async () => {
    const harness = makeHarness("caption");

    await expect(harness.firstRun()).rejects.toThrow(
      "candidate save failed after caption upload",
    );
    expect(harness.checkpoint()).toEqual({
      step: "captions",
      data: {
        language: "it",
        youtubeVideoId: "youtube-it",
        youtubeCaptionId: "caption-it",
      },
    });

    await expect(harness.retry()).resolves.toBeUndefined();
    expect(harness.counts()).toEqual({ videoUploads: 1, captionUploads: 1 });
    expect(harness.current().voiceOvers?.[0]).toEqual(
      expect.objectContaining({
        youtubeVideoId: "youtube-it",
        youtubeCaptionId: "caption-it",
      }),
    );
  });
});
