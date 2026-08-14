import type { SourceVideo } from "@/src/domain/entities";
import type { ChannelRepository } from "@/src/ports/channel-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { IdPort } from "@/src/ports/id";
import type { Logger } from "@/src/ports/logger";
import type { SourceVideoRepository } from "@/src/ports/source-video-repository";
import type {
  YouTubeAuthPort,
  YouTubeTokens,
} from "@/src/ports/youtube-auth";
import type { YouTubeCatalogPort } from "@/src/ports/youtube-catalog";

type SyncChannelDependencies = {
  auth: YouTubeAuthPort;
  catalog: YouTubeCatalogPort;
  channels: ChannelRepository;
  sourceVideos: SourceVideoRepository;
  id: IdPort;
  clock: ClockPort;
  logger: Logger;
};

export type SyncChannel = (channelId: string) => Promise<SourceVideo[]>;

async function getAccessToken(
  auth: YouTubeAuthPort,
  tokens: YouTubeTokens,
  now: Date,
): Promise<string> {
  if (tokens.expiresAt.getTime() > now.getTime() + 60_000) {
    return tokens.accessToken;
  }

  const refreshed = await auth.refreshAccessToken(tokens.refreshToken);
  await auth.saveTokens({ ...tokens, ...refreshed });
  return refreshed.accessToken;
}

export function createSyncChannel({
  auth,
  catalog,
  channels,
  sourceVideos,
  id,
  clock,
  logger,
}: SyncChannelDependencies): SyncChannel {
  const log = logger.child({ operation: "syncYouTubeChannel" });

  return async (channelId: string): Promise<SourceVideo[]> => {
    const startedAt = performance.now();
    log.info("YouTube channel sync started", { channelId });

    try {
      const [channel, tokens] = await Promise.all([
        channels.getById(channelId),
        auth.getStoredTokens(),
      ]);
      if (!channel) {
        throw new Error(`Channel not found: ${channelId}`);
      }
      if (!tokens) {
        throw new Error("YouTube channel is not connected");
      }

      const syncedAt = clock.now();
      const accessToken = await getAccessToken(auth, tokens, syncedAt);
      const metadata = await catalog.listChannelVideos(
        accessToken,
        channel.youtubeChannelId,
      );
      log.info("YouTube catalog fetched", {
        channelId,
        videoCount: metadata.length,
        durationMs: Math.round(performance.now() - startedAt),
      });

      const existingByYoutubeId = new Map(
        (await sourceVideos.listByChannelId(channelId)).map((video) => [
          video.youtubeVideoId,
          video,
        ]),
      );
      const videos = metadata.map((video): SourceVideo => {
        const existing = existingByYoutubeId.get(video.youtubeVideoId);
        return {
          id: existing?.id ?? id.generate(),
          channelId,
          youtubeVideoId: video.youtubeVideoId,
          title: video.title,
          durationSec: video.durationSec,
          localMediaPath: existing?.localMediaPath ?? null,
          analyticsSnapshot:
            video.statistics ?? existing?.analyticsSnapshot ?? null,
          publishedAt: video.publishedAt,
          syncedAt,
        };
      });

      await sourceVideos.upsertMany(videos);
      const liveYoutubeIds = new Set(
        videos.map((video) => video.youtubeVideoId),
      );
      const staleVideos = [...existingByYoutubeId.values()].filter(
        (video) => !liveYoutubeIds.has(video.youtubeVideoId),
      );
      const staleIds = staleVideos.map((video) => video.id);
      if (staleIds.length > 0) {
        await sourceVideos.deleteByIds(staleIds);
        log.info("Removed source videos missing from YouTube catalog", {
          channelId,
          removedCount: staleIds.length,
          youtubeVideoIds: staleVideos.map((video) => video.youtubeVideoId),
        });
      }
      const withStats = videos.filter((video) => video.analyticsSnapshot).length;
      log.info("YouTube channel sync completed", {
        channelId,
        videoCount: videos.length,
        videosWithStats: withStats,
        removedCount: staleIds.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return videos;
    } catch (error) {
      log.error("YouTube channel sync failed", {
        channelId,
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error),
        durationMs: Math.round(performance.now() - startedAt),
      });
      throw error;
    }
  };
}
