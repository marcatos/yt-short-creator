export type PublishReelInput = {
  igUserId: string;
  accessToken: string;
  filePath: string;
  caption: string;
  shareToFeed: boolean;
};

export type PublishReelResult = {
  mediaId: string;
  permalink: string | null;
};

export interface InstagramReelsPort {
  publishReel(input: PublishReelInput): Promise<PublishReelResult>;
}
