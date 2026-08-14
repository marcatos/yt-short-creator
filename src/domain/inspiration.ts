export type InspirationIdea = {
  id: string;
  title: string;
  summary: string;
  suggestedTitles: string[];
  outline: string;
  audienceInterest?: string;
  channelAlignment?: string;
  relatedInterest?: unknown;
  thumbnailNotes?: string;
};

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function uniqueTokens(tokens: string[]): Set<string> {
  return new Set(tokens);
}

function ideaCorpus(idea: InspirationIdea): string {
  return [
    idea.title,
    idea.summary,
    ...idea.suggestedTitles,
    idea.outline,
  ].join(" ");
}

/** Jaccard similarity: |A∩B| / |A∪B| over token sets. */
export function alignmentScore(
  candidateText: string,
  idea: InspirationIdea,
): number {
  const candidate = uniqueTokens(tokenize(candidateText));
  const ideaTokens = uniqueTokens(tokenize(ideaCorpus(idea)));
  if (candidate.size === 0 || ideaTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of candidate) {
    if (ideaTokens.has(token)) intersection += 1;
  }

  const union = candidate.size + ideaTokens.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

export function matchIdeas(
  candidateText: string,
  ideas: InspirationIdea[],
  minScore: number,
): { ideaIds: string[]; alignmentScore: number } {
  let bestScore = 0;
  const ideaIds: string[] = [];

  for (const idea of ideas) {
    const score = alignmentScore(candidateText, idea);
    if (score >= minScore) {
      ideaIds.push(idea.id);
    }
    if (score > bestScore) {
      bestScore = score;
    }
  }

  return { ideaIds, alignmentScore: bestScore };
}

export function boostScore(
  score: number,
  alignment: number,
  boost: number,
): number {
  return Math.min(1, score + boost * alignment);
}

export function applyQuotaReorder<T>(
  candidates: T[],
  isMatched: (candidate: T) => boolean,
  keepCount: number,
  quotaRatio: number,
): { ordered: T[]; shortfall: number } {
  const targetMatched = Math.ceil(keepCount * quotaRatio);
  const matched = candidates.filter(isMatched);
  const unmatched = candidates.filter((c) => !isMatched(c));
  const ordered = [...matched, ...unmatched].slice(0, keepCount);
  const matchedInKept = ordered.filter(isMatched).length;
  const shortfall = Math.max(0, targetMatched - matchedInKept);

  return { ordered, shortfall };
}

export function selectIdeasForGenerateFill(
  ideas: InspirationIdea[],
  alreadyMatchedIds: Set<string>,
  maxFill: number,
): InspirationIdea[] {
  if (maxFill <= 0) return [];
  return ideas.filter((idea) => !alreadyMatchedIds.has(idea.id)).slice(0, maxFill);
}
