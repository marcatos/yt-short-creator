import { NextResponse } from "next/server";

import { getContainer } from "@/src/lib/container";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const result = await getContainer().jobQueue.resume(id);
  if (!result.ok && result.code === "not_found") {
    return NextResponse.json({ error: result.message }, { status: 404 });
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
