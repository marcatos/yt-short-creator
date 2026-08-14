import { describe, expect, it } from "vitest";

import { createConnectChannel } from "@/src/application/connect-channel";
import { createSyncChannel } from "@/src/application/sync-channel";
import type { Channel, SourceVideo } from "@/src/domain/entities";
import type { ChannelRepository } from "@/src/ports/channel-repository";
import type { Logger } from "@/src/ports/logger";
import type { SourceVideoRepository } from "@/src/ports/source-video-repository";
import type {
  YouTubeAuthPort,
  YouTubeTokens,
} from "@/src/ports/youtube-auth";
import type {
  YouTubeCatalogPort,
  YouTubeVideoMetadata,
} from "@/src/ports/youtube-catalog";

const now = new Date("2026-08-11T10:00:00.000Z");
const tokens: YouTubeTokens = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresAt: new Date("2026-08-11T11:00:00.000Z"),
};

class MemoryChannelRepository implements ChannelRepository {
  readonly items = new Map<string, Channel>();

  async save(channel: Channel): Promise<void> {
    this.items.set(channel.id, channel);
  }

  async getById(id: string): Promise<Channel | null> {
    return this.items.get(id) ?? null;
  }

  async getByYoutubeChannelId(youtubeChannelId: string): Promise<Channel | null> {
    return (
      [...this.items.values()].find(
        (channel) => channel.youtubeChannelId === youtubeChannelId,
      ) ?? null
    );
  }

  async list(): Promise<Channel[]> {
    return [...this.items.values()];
  }
}

class MemorySourceVideoRepository implements SourceVideoRepository {
  readonly items = new Map<string, SourceVideo>();

  async save(video: SourceVideo): Promise<void> {
    this.items.set(video.id, video);
  }

  async getById(id: string): Promise<SourceVideo | null> {
    return this.items.get(id) ?? null;
  }

  async getByYoutubeVideoId(youtubeVideoId: string): Promise<SourceVideo | null> {
    return (
      [...this.items.values()].find(
        (video) => video.youtubeVideoId === youtubeVideoId,
      ) ?? null
    );
  }

  async listByChannelId(channelId: string): Promise<SourceVideo[]> {
    return [...this.items.values()].filter(
      (video) => video.channelId === channelId,
    );
  }

  async upsertMany(videos: SourceVideo[]): Promise<void> {
    videos.forEach((video) => this.items.set(video.id, video));
  }

  async deleteByIds(ids: string[]): Promise<void> {
    ids.forEach((id) => this.items.delete(id));
  }
}

function createAuth(stored: YouTubeTokens | null = tokens): YouTubeAuthPort {
  let current = stored;
  return {
    getAuthorizationUrl: async () => "https://accounts.google.com/o/oauth2/auth",
    exchangeCode: async () => tokens,
    refreshAccessToken: async () => ({
      accessToken: "refreshed",
      expiresAt: new Date("2026-08-11T12:00:00.000Z"),
    }),
    getStoredTokens: async () => current,
    saveTokens: async (next) => {
      current = next;
    },
  };
}

function createLogger(): Logger & { entries: string[] } {
  const entries: string[] = [];
  const logger: Logger & { entries: string[] } = {
    entries,
    debug: (message) => entries.push(`DEBUG:${message}`),
    info: (message) => entries.push(`INFO:${message}`),
    warn: (message) => entries.push(`WARN:${message}`),
    error: (message) => entries.push(`ERROR:${message}`),
    child: () => logger,
  };
  return logger;
}

const metadata: YouTubeVideoMetadata[] = [
  {
    youtubeVideoId: "video-1",
    title: "Race highlights",
    durationSec: 125,
    publishedAt: new Date("2026-08-10T12:00:00.000Z"),
    thumbnailUrl: "https://i.ytimg.com/vi/video-1/default.jpg",
    statistics: {
      viewCount: 1200,
      likeCount: 40,
      commentCount: 8,
    },
  },
];

function createCatalog(): YouTubeCatalogPort {
  return {
    getChannelInfo: async () => ({
      youtubeChannelId: "UC42",
      title: "S.Marcato 42 Racing",
    }),
    listChannelVideos: async () => metadata,
  };
}

describe("YouTube channel use cases", () => {
  it("exchanges the OAuth code, saves tokens, and persists the channel", async () => {
    const channels = new MemoryChannelRepository();
    const logger = createLogger();
    const connectChannel = createConnectChannel({
      auth: createAuth(null),
      catalog: createCatalog(),
      channels,
      id: { generate: () => "channel-1" },
      clock: { now: () => now },
      logger,
    });

    const channel = await connectChannel("oauth-code");

    expect(channel).toEqual({
      id: "channel-1",
      youtubeChannelId: "UC42",
      title: "S.Marcato 42 Racing",
      connectedAt: now,
    });
    expect(await channels.getById("channel-1")).toEqual(channel);
    expect(logger.entries).toContain("INFO:YouTube channel connection started");
    expect(logger.entries).toContain("INFO:YouTube channel connection completed");
  });

  it("syncs videos while preserving local fields and stable IDs", async () => {
    const channels = new MemoryChannelRepository();
    const videos = new MemorySourceVideoRepository();
    const logger = createLogger();
    await channels.save({
      id: "channel-1",
      youtubeChannelId: "UC42",
      title: "S.Marcato 42 Racing",
      connectedAt: now,
    });
    await videos.save({
      id: "source-existing",
      channelId: "channel-1",
      youtubeVideoId: "video-1",
      title: "Old title",
      durationSec: 100,
      localMediaPath: "media/video-1.mp4",
      analyticsSnapshot: { viewCount: 42, likeCount: 1, commentCount: 0 },
      publishedAt: null,
      syncedAt: new Date("2026-08-10T10:00:00.000Z"),
    });
    const syncChannel = createSyncChannel({
      auth: createAuth(),
      catalog: createCatalog(),
      channels,
      sourceVideos: videos,
      id: { generate: () => "unused-id" },
      clock: { now: () => now },
      logger,
    });

    const synced = await syncChannel("channel-1");

    expect(synced).toEqual([
      {
        id: "source-existing",
        channelId: "channel-1",
        youtubeVideoId: "video-1",
        title: "Race highlights",
        durationSec: 125,
        localMediaPath: "media/video-1.mp4",
        analyticsSnapshot: {
          viewCount: 1200,
          likeCount: 40,
          commentCount: 8,
        },
        publishedAt: new Date("2026-08-10T12:00:00.000Z"),
        syncedAt: now,
      },
    ]);
    expect(logger.entries).toContain("INFO:YouTube channel sync completed");
  });

  it("removes source videos that are no longer on the YouTube channel", async () => {
    const channels = new MemoryChannelRepository();
    const videos = new MemorySourceVideoRepository();
    await channels.save({
      id: "channel-1",
      youtubeChannelId: "UC42",
      title: "S.Marcato 42 Racing",
      connectedAt: now,
    });
    await videos.save({
      id: "source-live",
      channelId: "channel-1",
      youtubeVideoId: "video-1",
      title: "Race highlights",
      durationSec: 125,
      localMediaPath: null,
      analyticsSnapshot: null,
      publishedAt: new Date("2026-08-10T12:00:00.000Z"),
      syncedAt: new Date("2026-08-10T10:00:00.000Z"),
    });
    await videos.save({
      id: "source-deleted",
      channelId: "channel-1",
      youtubeVideoId: "video-deleted",
      title: "Old upload",
      durationSec: 60,
      localMediaPath: "media/old.mp4",
      analyticsSnapshot: { viewCount: 10, likeCount: 0, commentCount: 0 },
      publishedAt: new Date("2026-07-01T12:00:00.000Z"),
      syncedAt: new Date("2026-08-10T10:00:00.000Z"),
    });
    const logger = createLogger();
    const syncChannel = createSyncChannel({
      auth: createAuth(),
      catalog: createCatalog(),
      channels,
      sourceVideos: videos,
      id: { generate: () => "unused-id" },
      clock: { now: () => now },
      logger,
    });

    await syncChannel("channel-1");

    expect(await videos.listByChannelId("channel-1")).toEqual([
      expect.objectContaining({
        id: "source-live",
        youtubeVideoId: "video-1",
      }),
    ]);
    expect(await videos.getById("source-deleted")).toBeNull();
    expect(logger.entries).toContain(
      "INFO:Removed source videos missing from YouTube catalog",
    );
  });

  it("rejects sync when the channel is not connected", async () => {
    const channels = new MemoryChannelRepository();
    await channels.save({
      id: "channel-1",
      youtubeChannelId: "UC42",
      title: "S.Marcato 42 Racing",
      connectedAt: now,
    });
    const syncChannel = createSyncChannel({
      auth: createAuth(null),
      catalog: createCatalog(),
      channels,
      sourceVideos: new MemorySourceVideoRepository(),
      id: { generate: () => "source-1" },
      clock: { now: () => now },
      logger: createLogger(),
    });

    await expect(syncChannel("channel-1")).rejects.toThrow(
      "YouTube channel is not connected",
    );
  });
});
