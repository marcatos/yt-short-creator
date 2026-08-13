export type YouTubeChannelInfo = {
  youtubeChannelId: string;
  title: string;
};

export type YouTubeVideoStatistics = {
  viewCount: number;
  likeCount: number;
  commentCount: number;
};

export type YouTubeVideoMetadata = {
  youtubeVideoId: string;
  title: string;
  durationSec: number;
  publishedAt: Date;
  thumbnailUrl: string | null;
  statistics: YouTubeVideoStatistics | null;
};

export interface YouTubeCatalogPort {
  getChannelInfo(accessToken: string): Promise<YouTubeChannelInfo>;
  listChannelVideos(
    accessToken: string,
    youtubeChannelId: string,
  ): Promise<YouTubeVideoMetadata[]>;
}
