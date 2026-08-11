import { notFound } from "next/navigation";

import { ReviewPanel } from "@/app/components/ReviewPanel";
import { getContainer } from "@/src/lib/container";

export const dynamic = "force-dynamic";

export default async function CandidateReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  try {
    const candidate = await getContainer().getCandidate({ candidateId: id });
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
          }}
        />
      </main>
    );
  } catch {
    notFound();
  }
}
