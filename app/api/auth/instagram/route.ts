import { randomBytes } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";

import { getContainer } from "@/src/lib/container";

const OAUTH_STATE_COOKIE = "instagram_oauth_state";

function oauthRedirectHost(): string | null {
  const redirectUri = process.env.META_REDIRECT_URI ?? "";
  try {
    return new URL(redirectUri).host;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { instagramAuth, logger } = getContainer();

  const expectedHost = oauthRedirectHost();
  const requestHost = request.headers.get("host");
  if (expectedHost && requestHost && requestHost !== expectedHost) {
    const protocol =
      expectedHost.includes("localhost") || expectedHost.startsWith("127.")
        ? "http"
        : request.nextUrl.protocol.replace(":", "") || "http";
    const target = `${protocol}://${expectedHost}/api/auth/instagram`;
    logger.info("Instagram OAuth host realign", {
      from: requestHost,
      to: expectedHost,
    });
    return NextResponse.redirect(target);
  }

  if (!instagramAuth.isConfigured()) {
    return NextResponse.redirect(
      new URL("/connect?instagram=start_failed", request.url),
    );
  }

  const state = randomBytes(32).toString("base64url");

  try {
    const authorizationUrl = await instagramAuth.getAuthorizationUrl(state);
    const response = NextResponse.redirect(authorizationUrl);
    const redirectUri = process.env.META_REDIRECT_URI ?? "";
    const secureCookie = redirectUri.startsWith("https://");
    response.cookies.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: 600,
      path: "/",
      sameSite: "lax",
      secure: secureCookie,
    });
    logger.info("Instagram OAuth authorization started");
    return response;
  } catch (error) {
    logger.error("Instagram OAuth authorization failed", {
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : String(error),
    });
    return NextResponse.redirect(
      new URL("/connect?instagram=start_failed", request.url),
    );
  }
}
