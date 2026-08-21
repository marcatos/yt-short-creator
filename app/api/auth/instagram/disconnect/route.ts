import { NextResponse } from "next/server";

import { getContainer } from "@/src/lib/container";

export async function POST(): Promise<NextResponse> {
  const { disconnectInstagram } = getContainer();
  try {
    await disconnectInstagram();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Instagram disconnect failed",
      },
      { status: 500 },
    );
  }
}
