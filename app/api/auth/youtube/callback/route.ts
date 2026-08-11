import { timingSafeEqual } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";

import { getContainer } from "@/src/lib/container";

const OAUTH_STATE_COOKIE = "youtube_oauth_state";

function validState(received: string | null, expected: string | undefined) {
  if (!received || !expected) {
    return false;
  }
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { connectChannel, syncChannel, logger } = getContainer();
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");
  const storedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const stateValid = validState(state, storedState);

  if (oauthError || !code || !stateValid) {
    logger.warn("YouTube OAuth callback rejected", {
      oauthError,
      hasCode: Boolean(code),
      stateValid,
    });
    const response = NextResponse.json(
      { error: oauthError ?? "Invalid YouTube OAuth callback" },
      { status: 400 },
    );
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  }

  try {
    const channel = await connectChannel(code);
    await syncChannel(channel.id);
    const response = NextResponse.redirect(
      new URL("/library?connected=1", request.url),
    );
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  } catch (error) {
    logger.error("YouTube OAuth callback failed", {
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : String(error),
    });
    const response = NextResponse.json(
      { error: "Unable to connect and sync the YouTube channel" },
      { status: 500 },
    );
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  }
}
