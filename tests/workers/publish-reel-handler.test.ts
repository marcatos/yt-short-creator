import { describe, expect, it, vi } from "vitest";

import type { ShortCandidate } from "@/src/domain/entities";
import type { Logger } from "@/src/ports/logger";
import { createPublishReelHandler } from "@/src/workers/publish-reel-handler";

const now = new Date("2026-08-19T10:00:00.000Z");

function logger(): Logger {
  const instance: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => instance,
  };
  return instance;
}

describe("publish_reel handler", () => {
  it("publishes the Italian render and stores instagram_publish_jobs", async () => {
    let candidate: ShortCandidate = {
      id: "candidate-1",
      origin: "clip",
      status: "publishing",
      title: "Fallback title",
      description: "Fallback description",
      tags: [],
      score: 1,
      provenance: {
        sourceVideoId: "source-1",
        startMs: 0,
        endMs: 1_000,
        hookReason: "Test",
        crop: { mode: "center_vertical", focusX: 0.5 },
      },
      renderOutputPath: null,
      voiceOvers: [
        {
          language: "it",
          script: "Script IT",
          title: "Titolo IT",
          description: "Descrizione IT",
          voiceProfile: "ash",
          audioPath: "media/voice/it.mp3",
          words: [],
          srtPath: "media/voice/it.srt",
          assPath: "media/voice/it.ass",
          scriptHash: "it-hash",
          renderOutputPath: "media/renders/vo-it.mp4",
        },
      ],
      scheduledAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const savedJobs: Array<Record<string, unknown>> = [];
    const handler = createPublishReelHandler({
      logger: logger(),
      candidates: {
        async save(value) {
          candidate = value;
        },
        async getById(id) {
          return id === candidate.id ? candidate : null;
        },
        async list() {
          return [candidate];
        },
        async listByIds() {
          return [candidate];
        },
      },
      channels: {
        async save() {},
        async getById() {
          return null;
        },
        async getByYoutubeChannelId() {
          return null;
        },
        async list() {
          return [
            {
              id: "channel-1",
              youtubeChannelId: "UC123",
              title: "S.Marcato 42 Racing",
              connectedAt: now,
            },
          ];
        },
      },
      jobs: {
        async saveRenderJob() {},
        async savePublishJob() {},
        async getRenderJobById() {
          return null;
        },
        async getPublishJobById() {
          return null;
        },
        async getRenderJobByCandidateId() {
          return null;
        },
        async getPublishJobByCandidateId() {
          return null;
        },
        async listPublishJobsByCandidateIds() {
          return [];
        },
        async saveInstagramPublishJob(job) {
          savedJobs.push(job);
        },
        async getInstagramPublishJobById() {
          return null;
        },
        async getInstagramPublishJobByCandidateId() {
          return null;
        },
        async listInstagramPublishJobsByCandidateIds() {
          return [];
        },
      },
      settings: {
        async get() {
          return {
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
            instagramShareToFeed: true,
            instagramDefaultHashtags: ["iRacing", "SimRacing"],
          };
        },
        async save() {},
      },
      instagramAuth: {
        async getStoredTokens() {
          return {
            accessToken: "long-token",
            expiresAt: new Date(now.getTime() + 86_400_000),
            pageAccessToken: "page-token",
            pageId: "page-1",
            pageName: "Page",
            igUserId: "ig-user-1",
          };
        },
        async getAuthorizationUrl() {
          return "";
        },
        async exchangeCode() {
          throw new Error("unused");
        },
        async refreshLongLivedToken() {
          throw new Error("unused");
        },
        async saveTokens() {},
        async clearTokens() {},
        isConfigured: () => true,
      },
      instagramReels: {
        async publishReel(input) {
          expect(input).toMatchObject({
            igUserId: "ig-user-1",
            accessToken: "page-token",
            filePath: "media/renders/vo-it.mp4",
            shareToFeed: true,
          });
          expect(input.caption).toContain("https://www.youtube.com/channel/UC123");
          expect(input.caption).not.toContain("#Shorts");
          return {
            mediaId: "ig-media-1",
            permalink: "https://www.instagram.com/reel/abc/",
          };
        },
      },
      clock: { now: () => now },
    });

    const progress: string[] = [];
    await handler({
      jobId: "publish-reel-1",
      payload: { candidateId: candidate.id },
      checkpoint: null,
      setProgress(_pct, message) {
        progress.push(message);
      },
      async saveCheckpoint() {},
      signal: new AbortController().signal,
      shouldPause: () => false,
      throwIfPausedOrCancelled() {},
    });

    expect(savedJobs.at(-1)).toMatchObject({
      candidateId: "candidate-1",
      status: "succeeded",
      instagramMediaId: "ig-media-1",
      permalink: "https://www.instagram.com/reel/abc/",
    });
    expect(progress.at(-1)).toContain("Reel posted:");
  });

  it("fails gracefully when Instagram is not connected", async () => {
    const handler = createPublishReelHandler({
      logger: logger(),
      candidates: {
        async save() {},
        async getById() {
          return {
            id: "candidate-1",
            origin: "clip",
            status: "publishing",
            title: "Title",
            description: "Description",
            tags: [],
            score: 1,
            provenance: {
              sourceVideoId: "source-1",
              startMs: 0,
              endMs: 1_000,
              hookReason: "Test",
              crop: { mode: "center_vertical", focusX: 0.5 },
            },
            renderOutputPath: "media/renders/single.mp4",
            scheduledAt: null,
            createdAt: now,
            updatedAt: now,
          };
        },
        async list() {
          return [];
        },
        async listByIds() {
          return [];
        },
      },
      channels: {
        async save() {},
        async getById() {
          return null;
        },
        async getByYoutubeChannelId() {
          return null;
        },
        async list() {
          return [];
        },
      },
      jobs: {
        async saveRenderJob() {},
        async savePublishJob() {},
        async getRenderJobById() {
          return null;
        },
        async getPublishJobById() {
          return null;
        },
        async getRenderJobByCandidateId() {
          return null;
        },
        async getPublishJobByCandidateId() {
          return null;
        },
        async listPublishJobsByCandidateIds() {
          return [];
        },
        async saveInstagramPublishJob() {},
        async getInstagramPublishJobById() {
          return null;
        },
        async getInstagramPublishJobByCandidateId() {
          return null;
        },
        async listInstagramPublishJobsByCandidateIds() {
          return [];
        },
      },
      settings: {
        async get() {
          return {
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
            instagramShareToFeed: true,
            instagramDefaultHashtags: ["iRacing"],
          };
        },
        async save() {},
      },
      instagramAuth: {
        async getStoredTokens() {
          return null;
        },
        async getAuthorizationUrl() {
          return "";
        },
        async exchangeCode() {
          throw new Error("unused");
        },
        async refreshLongLivedToken() {
          throw new Error("unused");
        },
        async saveTokens() {},
        async clearTokens() {},
        isConfigured: () => true,
      },
      instagramReels: {
        async publishReel() {
          throw new Error("should not publish");
        },
      },
      clock: { now: () => now },
    });

    await expect(
      handler({
        jobId: "publish-reel-2",
        payload: { candidateId: "candidate-1" },
        checkpoint: null,
        setProgress() {},
        async saveCheckpoint() {},
        signal: new AbortController().signal,
        shouldPause: () => false,
        throwIfPausedOrCancelled() {},
      }),
    ).rejects.toThrow("Instagram is not connected");
  });
});
