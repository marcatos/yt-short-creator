import { NextResponse } from "next/server";

import { getContainer } from "@/src/lib/container";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const to =
    typeof body === "object" && body !== null && "to" in body
      ? body.to
      : undefined;
  if (to !== "top" && to !== "bottom") {
    return NextResponse.json(
      { error: 'to must be "top" or "bottom"' },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  const queue = getContainer().jobQueue;
  if (!queue.getJob(id)) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  try {
    await queue.move(id, to);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 409 },
    );
  }
}
