import { describe, expect, it } from "vitest";

import type { ShortCandidate } from "@/src/domain/entities";
import type { Logger } from "@/src/ports/logger";
import { createPublishShortHandler } from "@/src/workers/publish-short-handler";
import type { JobHandlerContext } from "@/src/workers/job-handler-context";

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
      {
        language: "en",
        script: "The decisive pass.",
        title: "Last-lap overtake",
        description: "The decisive braking move.",
        voiceProfile: "coral",
        audioPath: "media/voice/vo-en.mp3",
        words: [],
        srtPath: "media/voice/vo-en.srt",
        assPath: "media/voice/vo-en.ass",
        scriptHash: "en-hash",
        renderOutputPath: "media/renders/vo-en.mp4",
      },
    ],
    scheduledAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function context(
  language: "it" | "en",
  title: string,
  description: string,
): JobHandlerContext {
  return {
    jobId: `publish-${language}`,
    payload: {
      candidateId: "candidate-42",
      language,
      filePath: `media/renders/vo-${language}.mp4`,
      srtPath: `media/voice/vo-${language}.srt`,
      title,
      description,
    },
    checkpoint: null,
    setProgress() {},
    saveCheckpoint: async () => {},
    signal: new AbortController().signal,
    shouldPause: () => false,
    throwIfPausedOrCancelled() {},
  };
}

describe("publish_short bilingual VO flow", () => {
  it("uploads each localized video then its matching SRT caption", async () => {
    let current = candidate();
    const operations: string[] = [];
    const uploads: Array<Record<string, unknown>> = [];
    const captionUploads: Array<Record<string, unknown>> = [];
    const handler = createPublishShortHandler({
      logger: logger(),
      candidates: {
        save: async (value) => {
          current = value;
        },
        getById: async () => current,
        list: async () => [current],
      },
      jobs: {
        saveRenderJob: async () => {},
        savePublishJob: async () => {
          throw new Error("VO publish must not use the single candidate publish row");
        },
        getRenderJobById: async () => null,
        getPublishJobById: async () => null,
        getRenderJobByCandidateId: async () => null,
        getPublishJobByCandidateId: async () => null,
      },
      queue: {
        enqueue: async () => "unused",
        getProgress: async () => null,
        listJobs: () => [],
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
        upload: async (input) => {
          operations.push(`video:${input.title}`);
          uploads.push(input);
          return {
            youtubeVideoId: input.title.includes("Sorpasso")
              ? "youtube-it"
              : "youtube-en",
          };
        },
      },
      captions: {
        upload: async (input) => {
          operations.push(`caption:${input.language}`);
          captionUploads.push(input);
          return { youtubeCaptionId: `caption-${input.language}` };
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

    await handler(
      context("it", "Sorpasso all'ultimo giro", "La staccata decisiva."),
    );
    expect(current.status).toBe("publishing");
    await handler(
      context("en", "Last-lap overtake", "The decisive braking move."),
    );

    expect(operations).toEqual([
      "video:Sorpasso all'ultimo giro",
      "caption:it",
      "video:Last-lap overtake",
      "caption:en",
    ]);
    expect(uploads).toEqual([
      expect.objectContaining({
        filePath: "media/renders/vo-it.mp4",
        title: "Sorpasso all'ultimo giro",
        description: "La staccata decisiva.",
        contentKind: "short",
      }),
      expect.objectContaining({
        filePath: "media/renders/vo-en.mp4",
        title: "Last-lap overtake",
        description: "The decisive braking move.",
        contentKind: "short",
      }),
    ]);
    expect(captionUploads).toEqual([
      expect.objectContaining({
        youtubeVideoId: "youtube-it",
        filePath: "media/voice/vo-it.srt",
        language: "it",
        name: "VO",
      }),
      expect.objectContaining({
        youtubeVideoId: "youtube-en",
        filePath: "media/voice/vo-en.srt",
        language: "en",
        name: "VO",
      }),
    ]);
    expect(current.voiceOvers).toEqual([
      expect.objectContaining({
        language: "it",
        youtubeVideoId: "youtube-it",
        youtubeCaptionId: "caption-it",
      }),
      expect.objectContaining({
        language: "en",
        youtubeVideoId: "youtube-en",
        youtubeCaptionId: "caption-en",
      }),
    ]);
    expect(current.status).toBe("published");
  });

  it("retries captions without uploading the video again", async () => {
    let current = candidate();
    current = {
      ...current,
      status: "publishing",
      voiceOvers: current.voiceOvers!.map((voiceOver) =>
        voiceOver.language === "it"
          ? { ...voiceOver, youtubeVideoId: "youtube-it" }
          : voiceOver,
      ),
    };
    let videoUploads = 0;
    let captionUploads = 0;
    const handler = createPublishShortHandler({
      logger: logger(),
      candidates: {
        save: async (value) => {
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
        listJobs: () => [],
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
        upload: async () => {
          videoUploads += 1;
          return { youtubeVideoId: "unexpected" };
        },
      },
      captions: {
        upload: async () => {
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

    await handler(
      context("it", "Sorpasso all'ultimo giro", "La staccata decisiva."),
    );

    expect(videoUploads).toBe(0);
    expect(captionUploads).toBe(1);
  });
});
