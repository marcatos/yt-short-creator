export type InstagramTokens = {
  accessToken: string;
  expiresAt: Date;
  pageAccessToken: string;
  pageId: string;
  pageName: string;
  igUserId: string;
};

export interface InstagramAuthPort {
  getAuthorizationUrl(state: string): Promise<string>;
  exchangeCode(code: string): Promise<InstagramTokens>;
  refreshLongLivedToken(accessToken: string): Promise<{
    accessToken: string;
    expiresAt: Date;
  }>;
  getStoredTokens(): Promise<InstagramTokens | null>;
  saveTokens(tokens: InstagramTokens): Promise<void>;
  clearTokens(): Promise<void>;
  isConfigured(): boolean;
}
