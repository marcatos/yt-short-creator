import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getContainer } from "@/src/lib/container";

const metadataSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().max(5000),
  tags: z.array(z.string()).max(30),
  scheduledAt: z.string().datetime().nullable(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const candidate = await getContainer().getCandidate({ candidateId: id });
    return NextResponse.json({ candidate });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Candidate lookup failed" },
      { status: 404 },
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const parsed = metadataSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid candidate metadata" }, { status: 400 });
  }
  try {
    const { id } = await context.params;
    const candidate = await getContainer().updateCandidateMetadata({
      candidateId: id,
      ...parsed.data,
      scheduledAt: parsed.data.scheduledAt
        ? new Date(parsed.data.scheduledAt)
        : null,
    });
    return NextResponse.json({ candidate });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Metadata update failed" },
      { status: 409 },
    );
  }
}
