import { NextResponse } from "next/server";

import { getContainer } from "@/src/lib/container";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orderedIds =
    typeof body === "object" && body !== null && "orderedIds" in body
      ? body.orderedIds
      : undefined;
  if (
    !Array.isArray(orderedIds) ||
    !orderedIds.every((id) => typeof id === "string")
  ) {
    return NextResponse.json(
      { error: "orderedIds must be string[]" },
      { status: 400 },
    );
  }

  try {
    await getContainer().jobQueue.reorder(orderedIds);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
