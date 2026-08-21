import fs from "node:fs/promises";
import path from "node:path";

import type {
  InstagramAuthPort,
  InstagramTokens,
} from "@/src/ports/instagram-auth";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

const META_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
];

type MetaOAuthConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  tokenPath?: string;
};

type StoredTokenFile = {
  accessToken: string;
  expiresAt: string;
  pageAccessToken: string;
  pageId: string;
  pageName: string;
  igUserId: string;
};

type GraphErrorBody = {
  error?: { message?: string; type?: string; code?: number };
};

type PageAccount = {
  id: string;
  name: string;
  access_token?: string;
  instagram_business_account?: { id: string; username?: string };
};

async function graphGet<T>(
  url: string,
  params: Record<string, string>,
): Promise<T> {
  const query = new URLSearchParams(params);
  const response = await fetch(`${url}?${query.toString()}`);
  const body = (await response.json()) as T & GraphErrorBody;
  if (!response.ok || body.error) {
    throw new Error(
      body.error?.message ??
        `Meta Graph API request failed (${response.status})`,
    );
  }
  return body;
}

export class MetaInstagramAuthAdapter implements InstagramAuthPort {
  private readonly tokenPath: string;
  private readonly configured: boolean;

  constructor(private readonly config: MetaOAuthConfig) {
    this.configured = Boolean(config.appId && config.appSecret);
    this.tokenPath =
      config.tokenPath ??
      path.join(process.cwd(), "data", "instagram-tokens.json");
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async getAuthorizationUrl(state: string): Promise<string> {
    this.assertConfigured();
    const params = new URLSearchParams({
      client_id: this.config.appId,
      redirect_uri: this.config.redirectUri,
      state,
      scope: META_SCOPES.join(","),
      response_type: "code",
    });
    return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<InstagramTokens> {
    this.assertConfigured();
    const shortLived = await graphGet<{
      access_token: string;
      token_type?: string;
      expires_in?: number;
    }>(`${GRAPH_BASE}/oauth/access_token`, {
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      redirect_uri: this.config.redirectUri,
      code,
    });

    const longLived = await this.refreshLongLivedToken(shortLived.access_token);
    const page = await this.resolveInstagramPage(longLived.accessToken);

    return {
      accessToken: longLived.accessToken,
      expiresAt: longLived.expiresAt,
      pageAccessToken: page.pageAccessToken,
      pageId: page.pageId,
      pageName: page.pageName,
      igUserId: page.igUserId,
    };
  }

  async refreshLongLivedToken(accessToken: string): Promise<{
    accessToken: string;
    expiresAt: Date;
  }> {
    this.assertConfigured();
    const body = await graphGet<{
      access_token: string;
      token_type?: string;
      expires_in?: number;
    }>(`${GRAPH_BASE}/oauth/access_token`, {
      grant_type: "fb_exchange_token",
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      fb_exchange_token: accessToken,
    });
    const expiresInSec = body.expires_in ?? 60 * 24 * 60 * 60;
    return {
      accessToken: body.access_token,
      expiresAt: new Date(Date.now() + expiresInSec * 1000),
    };
  }

  private async resolveInstagramPage(userAccessToken: string): Promise<{
    pageId: string;
    pageName: string;
    pageAccessToken: string;
    igUserId: string;
    username: string;
  }> {
    const accounts = await graphGet<{ data: PageAccount[] }>(
      `${GRAPH_BASE}/me/accounts`,
      {
        fields:
          "id,name,access_token,instagram_business_account{id,username}",
        access_token: userAccessToken,
      },
    );

    for (const page of accounts.data ?? []) {
      const ig = page.instagram_business_account;
      if (!ig?.id || !page.access_token) continue;
      return {
        pageId: page.id,
        pageAccessToken: page.access_token,
        pageName: page.name,
        igUserId: ig.id,
        username: ig.username ?? ig.id,
      };
    }

    throw new Error(
      "No Facebook Page with a linked Instagram Business/Creator account was found",
    );
  }

  async getStoredTokens(): Promise<InstagramTokens | null> {
    try {
      const raw = await fs.readFile(this.tokenPath, "utf8");
      const stored = JSON.parse(raw) as StoredTokenFile;
      if (
        typeof stored.accessToken !== "string" ||
        typeof stored.expiresAt !== "string" ||
        typeof stored.pageAccessToken !== "string" ||
        typeof stored.pageId !== "string" ||
        typeof stored.pageName !== "string" ||
        typeof stored.igUserId !== "string"
      ) {
        throw new Error("Stored Instagram tokens have an invalid format");
      }
      const expiresAt = new Date(stored.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new Error("Stored Instagram token expiry is invalid");
      }
      return {
        accessToken: stored.accessToken,
        expiresAt,
        pageAccessToken: stored.pageAccessToken,
        pageId: stored.pageId,
        pageName: stored.pageName,
        igUserId: stored.igUserId,
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

  async saveTokens(tokens: InstagramTokens): Promise<void> {
    const directory = path.dirname(this.tokenPath);
    const temporaryPath = `${this.tokenPath}.${process.pid}.tmp`;
    const stored: StoredTokenFile = {
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt.toISOString(),
      pageAccessToken: tokens.pageAccessToken,
      pageId: tokens.pageId,
      pageName: tokens.pageName,
      igUserId: tokens.igUserId,
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

  async clearTokens(): Promise<void> {
    await fs.rm(this.tokenPath, { force: true });
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new Error("Meta OAuth app credentials are not configured");
    }
  }
}

export async function fetchInstagramUsername(
  igUserId: string,
  accessToken: string,
): Promise<string> {
  const body = await graphGet<{ username?: string }>(
    `${GRAPH_BASE}/${igUserId}`,
    {
      fields: "username",
      access_token: accessToken,
    },
  );
  return body.username ?? igUserId;
}
