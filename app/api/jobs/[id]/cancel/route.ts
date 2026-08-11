import { NextResponse } from "next/server";

import { getContainer } from "@/src/lib/container";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const queue = getContainer().jobQueue;
  if (!queue.getJob(id)) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const result = await queue.cancel(id);
  return NextResponse.json({ ok: true, result });
}
