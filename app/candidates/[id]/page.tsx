import { notFound } from "next/navigation";

import { ReviewPanel } from "@/app/components/ReviewPanel";
import { getContainer } from "@/src/lib/container";
import type {
  CandidateInspirationLink,
  InspirationIdeaRecord,
} from "@/src/ports/inspiration-store";

export const dynamic = "force-dynamic";

export default async function CandidateReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  try {
    const container = getContainer();
    const candidate = await container.getCandidate({ candidateId: id });
    const instagramPublishJob =
      await container.repositories.jobs.getInstagramPublishJobByCandidateId(id);
    const links =
      await container.repositories.inspiration.listLinksForCandidates([id]);
    let inspirationTitles: string[] | undefined;
    if (links.length > 0) {
      const ideas: InspirationIdeaRecord[] =
        await container.repositories.inspiration.listActiveIdeas();
      const titleById = new Map(ideas.map((idea) => [idea.id, idea.title]));
      const titles = links
        .map((link: CandidateInspirationLink) => titleById.get(link.ideaId))
        .filter((title): title is string => Boolean(title));
      inspirationTitles = titles.length > 0 ? titles : ["Matched idea"];
    }
    return (
      <main className="page-shell">
        <ReviewPanel
          candidate={{
            id: candidate.id,
            origin: candidate.origin,
            status: candidate.status,
            title: candidate.title,
            description: candidate.description,
            tags: candidate.tags,
            score: candidate.score,
            scheduledAt: candidate.scheduledAt?.toISOString() ?? null,
            renderOutputPath: candidate.renderOutputPath,
            provenance: { ...candidate.provenance },
            voiceOvers: (candidate.voiceOvers ?? []).map((voiceOver) => ({
              language: voiceOver.language,
              hasAudio: Boolean(voiceOver.audioPath),
              hasCaptions: Boolean(voiceOver.srtPath),
              hasRender: Boolean(voiceOver.renderOutputPath),
              isPublished: Boolean(voiceOver.youtubeVideoId),
            })),
            inspirationTitles,
            instagramPublish: instagramPublishJob
              ? {
                  status: instagramPublishJob.status,
                  permalink: instagramPublishJob.permalink,
                  error: instagramPublishJob.error,
                }
              : null,
          }}
        />
      </main>
    );
  } catch {
    notFound();
  }
}
