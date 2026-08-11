export type YouTubeUploadInput = {
  accessToken: string;
  filePath: string;
  title: string;
  description: string;
  tags: string[];
  scheduledAt: Date | null;
  privacy: "public" | "unlisted" | "private";
};

export type YouTubeUploadResult = {
  youtubeVideoId: string;
};

export interface YouTubeUploadPort {
  upload(input: YouTubeUploadInput): Promise<YouTubeUploadResult>;
}
