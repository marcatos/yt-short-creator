import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getContainer } from "@/src/lib/container";

const generateRequestSchema = z.object({
  channelId: z.string().trim().min(1),
  count: z.number().int().min(1).max(10).default(3),
});

export async function POST(request: NextRequest) {
  const parsed = generateRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "channelId and a count between 1 and 10 are required" },
      { status: 400 },
    );
  }
  const jobId = await getContainer().jobQueue.enqueue({
    type: "ideate",
    payload: parsed.data,
  });
  return NextResponse.json({ jobId }, { status: 202 });
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }
  const job = getContainer().jobQueue.getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  return NextResponse.json({
    status: job.status,
    progressPct: job.progressPct,
    message: job.progressMessage,
  });
}
