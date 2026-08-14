export type CapturedInspirationIdea = {
  externalKey: string;
  title: string;
  summary: string;
  audienceInterest: string | null;
  channelAlignment: string | null;
  relatedInterest: unknown | null;
  outline: string | null;
  suggestedTitles: string[];
  thumbnailNotes: string | null;
  rawSnippet: string | null;
};

export type InspirationCaptureResult = {
  status: "ok" | "partial";
  ideas: CapturedInspirationIdea[];
};

export interface YouTubeStudioInspirationPort {
  sync(): Promise<InspirationCaptureResult>;
}

export class StudioSessionUnavailableError extends Error {
  constructor(
    message = "YouTube Studio session is unavailable; run npm run studio:login",
  ) {
    super(message);
    this.name = "StudioSessionUnavailableError";
  }
}

export class StudioInspirationUiError extends Error {
  constructor(
    message = "YouTube Studio Inspiration UI could not be scraped",
  ) {
    super(message);
    this.name = "StudioInspirationUiError";
  }
}
