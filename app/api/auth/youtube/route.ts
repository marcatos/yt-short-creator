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
    response.cookies.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: 600,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
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
