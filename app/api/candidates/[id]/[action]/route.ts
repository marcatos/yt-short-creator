import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getContainer } from "@/src/lib/container";

const revisionSchema = z.object({ note: z.string().trim().min(1).max(1000) });
type RouteContext = { params: Promise<{ id: string; action: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { id, action } = await context.params;
  const container = getContainer();
  try {
    if (action === "voice-over") {
      const voiceOvers = await container.generateShortVoiceOvers({
        candidateId: id,
      });
      return NextResponse.json({ voiceOvers });
    }

    let candidate;
    if (action === "approve") {
      candidate = await container.approveCandidate({ candidateId: id });
    } else if (action === "reject") {
      candidate = await container.rejectCandidate({ candidateId: id });
    } else if (action === "revise") {
      const parsed = revisionSchema.safeParse(await request.json());
      if (!parsed.success) {
        return NextResponse.json(
          { error: "A revision note is required" },
          { status: 400 },
        );
      }
      candidate = await container.requestRevision({ candidateId: id });
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 404 });
    }
    return NextResponse.json({ candidate });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Candidate action failed" },
      { status: 409 },
    );
  }
}
