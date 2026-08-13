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
  /** BCP-47 default language for the video (e.g. "it"). */
  defaultLanguage?: string;
  /** Spoken language of the default audio track. */
  defaultAudioLanguage?: string;
};

export type YouTubeUploadResult = {
  youtubeVideoId: string;
};

export type YouTubeLocalizationUpdateInput = {
  accessToken: string;
  youtubeVideoId: string;
  defaultLanguage: string;
  localizations: Record<string, { title: string; description: string }>;
};

export interface YouTubeUploadPort {
  upload(input: YouTubeUploadInput): Promise<YouTubeUploadResult>;
  /** Best-effort title/description localizations via videos.update. */
  updateLocalizations?(
    input: YouTubeLocalizationUpdateInput,
  ): Promise<void>;
}
