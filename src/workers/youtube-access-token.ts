import type { YouTubeAuthPort } from "@/src/ports/youtube-auth";

export async function currentYouTubeAccessToken(
  auth: YouTubeAuthPort,
  now: Date,
): Promise<string> {
  const tokens = await auth.getStoredTokens();
  if (!tokens) throw new Error("YouTube is not connected");
  if (tokens.expiresAt.getTime() > now.getTime() + 60_000) {
    return tokens.accessToken;
  }
  const refreshed = await auth.refreshAccessToken(tokens.refreshToken);
  await auth.saveTokens({
    ...tokens,
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
  });
  return refreshed.accessToken;
}
