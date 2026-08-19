import { randomBytes } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";

import { getContainer } from "@/src/lib/container";

const OAUTH_STATE_COOKIE = "youtube_oauth_state";

function oauthRedirectHost(): string | null {
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI ?? "";
  try {
    return new URL(redirectUri).host;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { auth, logger } = getContainer();

  // State cookie is host-bound. If the operator opened 127.0.0.1 but Google
  // redirects to localhost (or vice versa), bounce to the redirect-URI host first.
  const expectedHost = oauthRedirectHost();
  const requestHost = request.headers.get("host");
  if (expectedHost && requestHost && requestHost !== expectedHost) {
    const protocol = expectedHost.includes("localhost") || expectedHost.startsWith("127.")
      ? "http"
      : request.nextUrl.protocol.replace(":", "") || "http";
    const target = `${protocol}://${expectedHost}/api/auth/youtube`;
    logger.info("YouTube OAuth host realign", { from: requestHost, to: expectedHost });
    return NextResponse.redirect(target);
  }

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
    return NextResponse.redirect(new URL("/connect?oauth=start_failed", request.url));
  }
}
