import { google, type youtube_v3 } from "googleapis";

import type {
  YouTubeCatalogPort,
  YouTubeChannelInfo,
  YouTubeVideoMetadata,
} from "@/src/ports/youtube-catalog";

const VIDEO_BATCH_SIZE = 50;
const MAX_CONCURRENT_VIDEO_REQUESTS = 4;

function parseDurationSeconds(duration: string | null | undefined): number {
  if (!duration) {
    return 0;
  }

  const match =
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      duration,
    );
  if (!match) {
    return 0;
  }

  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  return Math.round(
    Number(days) * 86_400 +
      Number(hours) * 3_600 +
      Number(minutes) * 60 +
      Number(seconds),
  );
}

function thumbnailUrl(
  thumbnails: youtube_v3.Schema$ThumbnailDetails | undefined,
): string | null {
  return (
    thumbnails?.maxres?.url ??
    thumbnails?.standard?.url ??
    thumbnails?.high?.url ??
    thumbnails?.medium?.url ??
    thumbnails?.default?.url ??
    null
  );
}

function createClient(accessToken: string): youtube_v3.Youtube {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.youtube({ version: "v3", auth });
}

async function listUploadItems(
  youtube: youtube_v3.Youtube,
  playlistId: string,
): Promise<youtube_v3.Schema$PlaylistItem[]> {
  const items: youtube_v3.Schema$PlaylistItem[] = [];
  let pageToken: string | undefined;
  do {
    const response = await youtube.playlistItems.list({
      part: ["snippet", "contentDetails"],
      playlistId,
      maxResults: 50,
      pageToken,
    });
    items.push(...(response.data.items ?? []));
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  return items;
}

async function getVideoDetails(
  youtube: youtube_v3.Youtube,
  videoIds: string[],
): Promise<Map<string, youtube_v3.Schema$Video & { id: string }>> {
  const batches = Array.from(
    { length: Math.ceil(videoIds.length / VIDEO_BATCH_SIZE) },
    (_, index) =>
      videoIds.slice(
        index * VIDEO_BATCH_SIZE,
        (index + 1) * VIDEO_BATCH_SIZE,
      ),
  );
  const videos: youtube_v3.Schema$Video[] = [];
  for (
    let index = 0;
    index < batches.length;
    index += MAX_CONCURRENT_VIDEO_REQUESTS
  ) {
    const responses = await Promise.all(
      batches.slice(index, index + MAX_CONCURRENT_VIDEO_REQUESTS).map((id) =>
        youtube.videos.list({
          part: ["snippet", "contentDetails"],
          id,
          maxResults: VIDEO_BATCH_SIZE,
        }),
      ),
    );
    videos.push(...responses.flatMap((response) => response.data.items ?? []));
  }

  return new Map(
    videos
      .filter((video): video is youtube_v3.Schema$Video & { id: string } =>
        Boolean(video.id),
      )
      .map((video) => [video.id, video]),
  );
}

export class GoogleYouTubeCatalogAdapter implements YouTubeCatalogPort {
  async getChannelInfo(accessToken: string): Promise<YouTubeChannelInfo> {
    const youtube = createClient(accessToken);
    const response = await youtube.channels.list({
      part: ["snippet"],
      mine: true,
      maxResults: 1,
    });
    const channel = response.data.items?.[0];
    if (!channel?.id || !channel.snippet?.title) {
      throw new Error("No YouTube channel is available for this account");
    }

    return {
      youtubeChannelId: channel.id,
      title: channel.snippet.title,
    };
  }

  async listChannelVideos(
    accessToken: string,
    youtubeChannelId: string,
  ): Promise<YouTubeVideoMetadata[]> {
    const youtube = createClient(accessToken);
    const channelResponse = await youtube.channels.list({
      part: ["contentDetails"],
      id: [youtubeChannelId],
      maxResults: 1,
    });
    const uploadsPlaylistId =
      channelResponse.data.items?.[0]?.contentDetails?.relatedPlaylists
        ?.uploads;
    if (!uploadsPlaylistId) {
      throw new Error(
        `Uploads playlist not found for channel ${youtubeChannelId}`,
      );
    }

    const playlistItems = await listUploadItems(youtube, uploadsPlaylistId);
    const videoIds = playlistItems
      .map(
        (item) =>
          item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId,
      )
      .filter((videoId): videoId is string => Boolean(videoId));
    const detailsById = await getVideoDetails(youtube, videoIds);

    return videoIds.flatMap((youtubeVideoId) => {
      const video = detailsById.get(youtubeVideoId);
      const title = video?.snippet?.title;
      const publishedAt = video?.snippet?.publishedAt;
      if (!video || !title || !publishedAt) {
        return [];
      }

      return [
        {
          youtubeVideoId,
          title,
          durationSec: parseDurationSeconds(video.contentDetails?.duration),
          publishedAt: new Date(publishedAt),
          thumbnailUrl: thumbnailUrl(video.snippet?.thumbnails),
        },
      ];
    });
  }
}
