import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { recordToInspirationIdea } from "@/src/application/inspiration-prompt-block";
import { rankVideoIdeaPairs } from "@/src/domain/inspiration";
import { parseInspirationConfig } from "@/src/domain/inspiration-config";
import { getContainer } from "@/src/lib/container";

const previewSchema = z.object({
  sourceVideoIds: z.array(z.string().trim().min(1)).min(1),
  ideaIds: z.array(z.string().trim().min(1)).min(1),
  k: z.number().int().min(1).max(50).optional().default(5),
});

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  const parsed = previewSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "sourceVideoIds and ideaIds must be non-empty arrays; k must be 1–50",
      },
      { status: 400 },
    );
  }

  const container = getContainer();
  const log = container.logger.child({ route: "POST /api/match/preview" });
  const { sourceVideoIds, ideaIds, k } = parsed.data;
  const videoIdSet = new Set(sourceVideoIds);
  const ideaIdSet = new Set(ideaIds);
  const inspirationConfig = parseInspirationConfig(process.env);

  const [allIdeas, latestSuccessfulSyncAt, videos] = await Promise.all([
    container.repositories.inspiration.listActiveIdeas(),
    container.repositories.inspiration.getLatestSuccessfulSyncAt(),
    Promise.all(
      [...videoIdSet].map((id) =>
        container.repositories.sourceVideos.getById(id),
      ),
    ).then((rows) => rows.filter((video) => video != null)),
  ]);

  const ideaRecords = allIdeas.filter((idea) => ideaIdSet.has(idea.id));
  if (ideaRecords.length === 0) {
    return NextResponse.json(
      { error: "No matching active Inspiration ideas found" },
      { status: 400 },
    );
  }
  if (videos.length === 0) {
    return NextResponse.json(
      { error: "No matching source videos found" },
      { status: 400 },
    );
  }

  const now = container.clock.now();
  const pairs = rankVideoIdeaPairs(
    videos.map((video) => ({
      id: video.id,
      title: video.title,
      viewCount: video.analyticsSnapshot?.viewCount ?? null,
      likeCount: video.analyticsSnapshot?.likeCount ?? null,
      commentCount: video.analyticsSnapshot?.commentCount ?? null,
    })),
    ideaRecords.map(recordToInspirationIdea),
    {
      k,
      now,
      latestSuccessfulSyncAt,
      staleDays: inspirationConfig.staleDays,
      ideaCapturedAtById: Object.fromEntries(
        ideaRecords.map((idea) => [idea.id, idea.capturedAt]),
      ),
    },
  );

  log.info("Match preview ranked", {
    videoCount: videos.length,
    ideaCount: ideaRecords.length,
    k,
    pairCount: pairs.length,
    durationMs: Math.round(performance.now() - startedAt),
  });

  return NextResponse.json({
    pairs,
    meta: {
      videoCount: videos.length,
      ideaCount: ideaRecords.length,
      k,
      latestSuccessfulSyncAt,
      staleDays: inspirationConfig.staleDays,
    },
  });
}
