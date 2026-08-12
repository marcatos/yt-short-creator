import type { VoiceOverLanguage } from "@/src/domain/voice-over";

export type YouTubeCaptionUploadInput = {
  accessToken: string;
  youtubeVideoId: string;
  filePath: string;
  language: VoiceOverLanguage;
  name: string;
};

export type YouTubeCaptionUploadResult = {
  youtubeCaptionId: string;
};

export interface YouTubeCaptionsPort {
  upload(
    input: YouTubeCaptionUploadInput,
  ): Promise<YouTubeCaptionUploadResult>;
}
