export type YouTubeTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
};

export interface YouTubeAuthPort {
  getAuthorizationUrl(state: string): Promise<string>;
  exchangeCode(code: string): Promise<YouTubeTokens>;
  refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresAt: Date;
  }>;
  getStoredTokens(): Promise<YouTubeTokens | null>;
  saveTokens(tokens: YouTubeTokens): Promise<void>;
}
