import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getContainer } from "@/src/lib/container";

const pairSchema = z.object({
  sourceVideoId: z.string().trim().min(1),
  ideaId: z.string().trim().min(1),
});

const runSchema = z.object({
  channelId: z.string().trim().min(1),
  pairs: z.array(pairSchema).min(1),
});

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  const parsed = runSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "channelId and a non-empty pairs array are required" },
      { status: 400 },
    );
  }

  const container = getContainer();
  const log = container.logger.child({ route: "POST /api/match/run" });
  const jobId = await container.jobQueue.enqueue({
    type: "match_propose_shorts",
    payload: parsed.data,
  });

  log.info("Match propose enqueued", {
    jobId,
    channelId: parsed.data.channelId,
    pairCount: parsed.data.pairs.length,
    durationMs: Math.round(performance.now() - startedAt),
  });

  return NextResponse.json({ ok: true, jobId }, { status: 202 });
}
