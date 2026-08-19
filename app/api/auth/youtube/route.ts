import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { getContainer } from "@/src/lib/container";

const OAUTH_STATE_COOKIE = "youtube_oauth_state";

export async function GET(): Promise<NextResponse> {
  const { auth, logger } = getContainer();
  const state = randomBytes(32).toString("base64url");

  try {
    const authorizationUrl = await auth.getAuthorizationUrl(state);
    const response = NextResponse.redirect(authorizationUrl);
    // Production daemon is often served over plain http://127.0.0.1 — a Secure
    // cookie would never be stored, so the callback rejects state and leaves a blank JSON page.
    const redirectUri = process.env.YOUTUBE_REDIRECT_URI ?? "";
    const secureCookie = redirectUri.startsWith("https://");
    response.cookies.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: 600,
      path: "/",
      sameSite: "lax",
      secure: secureCookie,
    });
    logger.info("YouTube OAuth authorization started");
    return response;
  } catch (error) {
    logger.error("YouTube OAuth authorization failed", {
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : String(error),
    });
    return NextResponse.json(
      { error: "Unable to start YouTube authorization" },
      { status: 500 },
    );
  }
}
