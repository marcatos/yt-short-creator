import type { InspirationIdea } from "@/src/domain/inspiration";
import type {
  InspirationIdeaRecord,
  InspirationStorePort,
} from "@/src/ports/inspiration-store";

export function recordToInspirationIdea(
  record: InspirationIdeaRecord,
): InspirationIdea {
  return {
    id: record.id,
    title: record.title,
    summary: record.summary,
    suggestedTitles: record.suggestedTitles,
    outline: record.outline ?? "",
    audienceInterest: record.audienceInterest ?? undefined,
    channelAlignment: record.channelAlignment ?? undefined,
    relatedInterest: record.relatedInterest ?? undefined,
    thumbnailNotes: record.thumbnailNotes ?? undefined,
  };
}

export async function loadInspirationPromptBlock(
  store: InspirationStorePort | undefined,
  ideaIds?: string[],
): Promise<string> {
  if (!store) {
    return "";
  }
  let records = await store.listActiveIdeas();
  if (ideaIds?.length) {
    const allow = new Set(ideaIds);
    records = records.filter((record) => allow.has(record.id));
  }
  return formatInspirationPromptBlock(records.map(recordToInspirationIdea));
}

export function formatInspirationPromptBlock(ideas: InspirationIdea[]): string {
  if (ideas.length === 0) {
    return "";
  }

  const cards = ideas.map((idea, index) => {
    const lines = [`${index + 1}. ${idea.title}`];
    if (idea.summary) {
      lines.push(idea.summary);
    }
    if (idea.suggestedTitles.length > 0) {
      lines.push(`Suggested titles: ${idea.suggestedTitles.join("; ")}`);
    }
    return lines.join("\n");
  });

  return [
    "=== Active YouTube Inspiration ideas ===",
    "Prefer aligned angles and titles. Do not invent facts absent from the footage or brief.",
    ...cards,
  ].join("\n");
}
