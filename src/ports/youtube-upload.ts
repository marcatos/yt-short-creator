export type YouTubeUploadInput = {
  accessToken: string;
  filePath: string;
  title: string;
  description: string;
  tags: string[];
  scheduledAt: Date | null;
  privacy: "public" | "unlisted" | "private";
  /** Shorts get #Shorts appended; full race uploads must not. */
  contentKind?: "short" | "full";
};

export type YouTubeUploadResult = {
  youtubeVideoId: string;
};

export interface YouTubeUploadPort {
  upload(input: YouTubeUploadInput): Promise<YouTubeUploadResult>;
}
