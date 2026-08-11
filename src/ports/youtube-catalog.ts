export type YouTubeChannelInfo = {
  youtubeChannelId: string;
  title: string;
};

export type YouTubeVideoMetadata = {
  youtubeVideoId: string;
  title: string;
  durationSec: number;
  publishedAt: Date;
  thumbnailUrl: string | null;
};

export interface YouTubeCatalogPort {
  getChannelInfo(accessToken: string): Promise<YouTubeChannelInfo>;
  listChannelVideos(
    accessToken: string,
    youtubeChannelId: string,
  ): Promise<YouTubeVideoMetadata[]>;
}
