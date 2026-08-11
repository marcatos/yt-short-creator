import { NextResponse } from "next/server";

import { getContainer } from "@/src/lib/container";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const progress = await getContainer().jobQueue.getProgress(id);
  if (!progress) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  return NextResponse.json(progress);
}
