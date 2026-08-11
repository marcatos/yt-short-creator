import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { CANDIDATE_STATUSES } from "@/src/domain/status";
import { getContainer } from "@/src/lib/container";

const querySchema = z.object({
  status: z.enum(CANDIDATE_STATUSES).optional(),
  origin: z.enum(["clip", "generate"]).optional(),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    status: request.nextUrl.searchParams.get("status") || undefined,
    origin: request.nextUrl.searchParams.get("origin") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid candidate filters" }, { status: 400 });
  }
  const candidates = await getContainer().listCandidates(parsed.data);
  candidates.sort((left, right) => right.score - left.score);
  return NextResponse.json({ candidates });
}
