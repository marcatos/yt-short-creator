import { NextResponse } from "next/server";

import { getContainer } from "@/src/lib/container";

export async function POST() {
  const jobId = await getContainer().jobQueue.enqueue({
    type: "sync_inspiration",
    payload: { source: "manual" },
  });
  return NextResponse.json({ jobId }, { status: 202 });
}
