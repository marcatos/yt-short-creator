import type { InstagramAuthPort } from "@/src/ports/instagram-auth";

export async function currentInstagramAccessToken(
  auth: InstagramAuthPort,
  now: Date,
): Promise<{ accessToken: string; igUserId: string }> {
  const tokens = await auth.getStoredTokens();
  if (!tokens) throw new Error("Instagram is not connected");

  if (tokens.expiresAt.getTime() > now.getTime() + 60_000) {
    return {
      accessToken: tokens.pageAccessToken,
      igUserId: tokens.igUserId,
    };
  }

  const refreshed = await auth.refreshLongLivedToken(tokens.accessToken);
  const next = {
    ...tokens,
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
  };
  await auth.saveTokens(next);
  return {
    accessToken: next.pageAccessToken,
    igUserId: next.igUserId,
  };
}

export async function isInstagramConnected(
  auth: InstagramAuthPort,
): Promise<boolean> {
  const tokens = await auth.getStoredTokens();
  return tokens !== null;
}
