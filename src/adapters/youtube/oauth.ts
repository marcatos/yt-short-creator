import fs from "node:fs/promises";
import path from "node:path";

import { google } from "googleapis";

import type {
  YouTubeAuthPort,
  YouTubeTokens,
} from "@/src/ports/youtube-auth";

const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

type YouTubeOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenPath?: string;
};

type StoredTokenFile = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

export class GoogleYouTubeAuthAdapter implements YouTubeAuthPort {
  private readonly oauthClient;
  private readonly tokenPath: string;
  private readonly configured: boolean;

  constructor(config: YouTubeOAuthConfig) {
    this.oauthClient = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri,
    );
    this.configured = Boolean(config.clientId && config.clientSecret);
    this.tokenPath =
      config.tokenPath ??
      path.join(process.cwd(), "data", "youtube-tokens.json");
  }

  async getAuthorizationUrl(state: string): Promise<string> {
    this.assertConfigured();
    return this.oauthClient.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: YOUTUBE_SCOPES,
      state,
    });
  }

  async exchangeCode(code: string): Promise<YouTubeTokens> {
    this.assertConfigured();
    const { tokens } = await this.oauthClient.getToken(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error(
        "YouTube OAuth response did not include access and refresh tokens",
      );
    }

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(tokens.expiry_date ?? Date.now() + 3_600_000),
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresAt: Date;
  }> {
    this.assertConfigured();
    this.oauthClient.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await this.oauthClient.refreshAccessToken();
    if (!credentials.access_token) {
      throw new Error("YouTube OAuth refresh did not return an access token");
    }

    return {
      accessToken: credentials.access_token,
      expiresAt: new Date(credentials.expiry_date ?? Date.now() + 3_600_000),
    };
  }

  async getStoredTokens(): Promise<YouTubeTokens | null> {
    try {
      const raw = await fs.readFile(this.tokenPath, "utf8");
      const stored = JSON.parse(raw) as StoredTokenFile;
      if (
        typeof stored.accessToken !== "string" ||
        typeof stored.refreshToken !== "string" ||
        typeof stored.expiresAt !== "string"
      ) {
        throw new Error("Stored YouTube tokens have an invalid format");
      }

      const expiresAt = new Date(stored.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new Error("Stored YouTube token expiry is invalid");
      }
      return {
        accessToken: stored.accessToken,
        refreshToken: stored.refreshToken,
        expiresAt,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  async saveTokens(tokens: YouTubeTokens): Promise<void> {
    const directory = path.dirname(this.tokenPath);
    const temporaryPath = `${this.tokenPath}.${process.pid}.tmp`;
    const stored: StoredTokenFile = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt.toISOString(),
    };

    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      await fs.rename(temporaryPath, this.tokenPath);
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !(error instanceof Error) ||
        !("code" in error) ||
        !["EEXIST", "EPERM"].includes(String(error.code))
      ) {
        await fs.rm(temporaryPath, { force: true });
        throw error;
      }
      await fs.rm(this.tokenPath, { force: true });
      await fs.rename(temporaryPath, this.tokenPath);
    }
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new Error("YouTube OAuth client credentials are not configured");
    }
  }
}
