import { describe, expect, it } from "vitest";

import type { JobRecord } from "@/src/adapters/jobs/job-record";
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
  jobId = "publish-it",
): JobHandlerContext {
  const ctx: JobHandlerContext = {
    jobId,
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
    async saveCheckpoint(step, data) {
      await saveCheckpoint(step, data);
      ctx.checkpoint = data === undefined ? { step } : { step, data };
    },
    signal: new AbortController().signal,
    shouldPause: () => false,
    throwIfPausedOrCancelled() {},
  };
  return ctx;
}

function makeHarness(
  failAt: "video" | "caption" | null,
  options: { failFirstSidecarWrite?: boolean } = {},
) {
  let current = candidate();
  let checkpoint: JobCheckpoint | null = null;
  const sidecars = new Map<string, string>();
  const queueJobs: JobRecord[] = [];
  let failurePending = true;
  let sidecarFailurePending = options.failFirstSidecarWrite ?? false;
  let videoUploads = 0;
  let captionUploads = 0;
  const saveCheckpoint = async (
    jobId: string,
    step: string,
    data?: unknown,
  ) => {
    checkpoint = data === undefined ? { step } : { step, data };
    const job = queueJobs.find((item) => item.id === jobId);
    if (job) job.checkpoint = checkpoint;
  };
  const handler = createPublishShortHandler({
    logger: logger(),
    candidates: {
      async save(value) {
        const voiceOver = value.voiceOvers?.[0];
        const reachedFailure =
          failAt === null
            ? false
            : failAt === "video"
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
    queue: {
      enqueue: async () => "unused",
      getProgress: async () => null,
      listJobs: () => queueJobs,
    },
    settings: {
      get: async () => ({
        brandRoot: "brand",
        logLevel: "INFO",
        defaultPrivacy: "unlisted",
        videoEncoderPreference: "libx264",
        brandVoiceProfile: "coral",
    italianVoiceProfile: "ash",
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
    mediaStore: {
      sourcePath: () => "",
      renderPath: () => "",
      audioPath: () => "",
      brollPath: () => "",
      replayAnalysisDir: () => "",
      fullReplayEncodePath: () => "",
      listBroll: async () => [],
      ensureDirs: async () => {},
      voPublishCheckpointPath: (candidateId, language) =>
        `vo-publish-${candidateId}-${language}.json`,
      readText: async (filePath) => sidecars.get(filePath) ?? null,
      writeText: async (filePath, content) => {
        if (sidecarFailurePending) {
          sidecarFailurePending = false;
          throw new Error("sidecar write failed");
        }
        sidecars.set(filePath, content);
      },
    },
  });

  return {
    firstRun: () => {
      queueJobs.push(jobRecord("publish-it", "running", null));
      return handler(
        makeContext(null, (step, data) =>
          saveCheckpoint("publish-it", step, data),
        ),
      );
    },
    retry: () =>
      handler(
        makeContext(checkpoint, (step, data) =>
          saveCheckpoint("publish-it", step, data),
        ),
      ),
    replacementJob: () => {
      const prior = queueJobs.find((job) => job.id === "publish-it");
      if (prior) prior.status = "failed";
      queueJobs.push(jobRecord("publish-it-replacement", "running", null));
      return handler(
        makeContext(
          null,
          (step, data) =>
            saveCheckpoint("publish-it-replacement", step, data),
          "publish-it-replacement",
        ),
      );
    },
    seedSidecar: (value: Record<string, unknown>) => {
      sidecars.set(
        "vo-publish-candidate-42-it.json",
        JSON.stringify(value),
      );
    },
    setScriptHash: (scriptHash: string) => {
      current = {
        ...current,
        voiceOvers: current.voiceOvers?.map((voiceOver) => ({
          ...voiceOver,
          scriptHash,
        })),
      };
    },
    checkpoint: () => checkpoint,
    current: () => current,
    counts: () => ({ videoUploads, captionUploads }),
  };
}

function jobRecord(
  id: string,
  status: JobRecord["status"],
  checkpoint: JobCheckpoint | null,
): JobRecord {
  return {
    id,
    type: "publish_short",
    payload: { candidateId: "candidate-42", language: "it" },
    status,
    position: 0,
    progressPct: 0,
    progressMessage: "",
    checkpoint,
    error: null,
    createdAt: now,
    startedAt: now,
    finishedAt: null,
    updatedAt: now,
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
      data: {
        language: "it",
        scriptHash: "it-hash",
        renderOutputBasename: "vo-it.mp4",
        youtubeVideoId: "youtube-it",
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

  it("keeps the upload ids on the job checkpoint after a clean run", async () => {
    const harness = makeHarness(null);

    await expect(harness.firstRun()).resolves.toBeUndefined();

    expect(harness.checkpoint()).toEqual({
      step: "captions",
      data: {
        language: "it",
        scriptHash: "it-hash",
        renderOutputBasename: "vo-it.mp4",
        youtubeVideoId: "youtube-it",
        youtubeCaptionId: "caption-it",
      },
    });
  });

  it("recovers from a prior failed job when sidecar persistence fails", async () => {
    const harness = makeHarness("video", { failFirstSidecarWrite: true });

    await expect(harness.firstRun()).rejects.toThrow(
      "Failed to durably persist voice-over upload result",
    );
    expect(harness.checkpoint()).toEqual({
      step: "upload",
      data: {
        language: "it",
        scriptHash: "it-hash",
        renderOutputBasename: "vo-it.mp4",
        youtubeVideoId: "youtube-it",
      },
    });

    await expect(harness.replacementJob()).resolves.toBeUndefined();
    expect(harness.counts()).toEqual({ videoUploads: 1, captionUploads: 1 });
  });

  it("ignores a sidecar from a regenerated voice-over script", async () => {
    const harness = makeHarness(null);
    harness.seedSidecar({
      language: "it",
      scriptHash: "old-hash",
      renderOutputBasename: "vo-it.mp4",
      youtubeVideoId: "stale-video",
      youtubeCaptionId: "stale-caption",
    });
    harness.setScriptHash("regenerated-hash");

    await expect(harness.firstRun()).resolves.toBeUndefined();
    expect(harness.counts()).toEqual({ videoUploads: 1, captionUploads: 1 });
    expect(harness.current().voiceOvers?.[0]).toEqual(
      expect.objectContaining({
        youtubeVideoId: "youtube-it",
        youtubeCaptionId: "caption-it",
      }),
    );
  });

  it("recovers a video upload in a replacement job after candidate persistence fails", async () => {
    const harness = makeHarness("video");

    await expect(harness.firstRun()).rejects.toThrow(
      "candidate save failed after video upload",
    );

    await expect(harness.replacementJob()).resolves.toBeUndefined();
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
        scriptHash: "it-hash",
        renderOutputBasename: "vo-it.mp4",
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
