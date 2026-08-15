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

export type MatchPairWeights = {
  align: number;
  studio: number;
  analytics: number;
  fresh: number;
};

export const DEFAULT_MATCH_PAIR_WEIGHTS: MatchPairWeights = {
  align: 0.4,
  studio: 0.25,
  analytics: 0.25,
  fresh: 0.1,
};

export type VideoMatchInput = {
  id: string;
  title: string;
  viewCount?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
};

export type VideoIdeaPairScore = {
  sourceVideoId: string;
  ideaId: string;
  pairScore: number;
  align: number;
  studio: number;
  analytics: number;
  fresh: number;
};

export function studioSignalScore(idea: InspirationIdea): number {
  let score = 0;
  if (idea.audienceInterest?.trim()) score += 0.25;
  if (idea.channelAlignment?.trim()) score += 0.25;
  if (idea.relatedInterest != null) score += 0.25;
  if (idea.outline?.trim() || idea.suggestedTitles.length > 0) score += 0.25;
  return Math.min(1, score);
}

function log1p(n: number): number {
  return Math.log1p(Math.max(0, n));
}

export function analyticsScore(
  video: VideoMatchInput,
  cohort: VideoMatchInput[],
): number {
  const views = cohort.map((v) => log1p(v.viewCount ?? 0));
  const likes = cohort.map((v) => log1p(v.likeCount ?? 0));
  const comments = cohort.map((v) => log1p(v.commentCount ?? 0));
  const maxViews = Math.max(...views, 1e-9);
  const maxLikes = Math.max(...likes, 1e-9);
  const maxComments = Math.max(...comments, 1e-9);
  const v = log1p(video.viewCount ?? 0) / maxViews;
  const l = log1p(video.likeCount ?? 0) / maxLikes;
  const c = log1p(video.commentCount ?? 0) / maxComments;
  return Math.min(1, 0.5 * v + 0.3 * l + 0.2 * c);
}

export function freshScore(input: {
  ideaCapturedAt: Date;
  latestSuccessfulSyncAt: Date | null;
  now: Date;
  staleDays: number;
}): number {
  if (!input.latestSuccessfulSyncAt) return 0.2;
  const ageMs = input.now.getTime() - input.latestSuccessfulSyncAt.getTime();
  const staleMs = input.staleDays * 24 * 60 * 60 * 1000;
  if (ageMs > staleMs) return 0.25;
  const sameSync =
    Math.abs(
      input.ideaCapturedAt.getTime() - input.latestSuccessfulSyncAt.getTime(),
    ) <
    24 * 60 * 60 * 1000;
  return sameSync ? 1 : 0.7;
}

export function scoreVideoIdeaPair(input: {
  video: VideoMatchInput;
  idea: InspirationIdea;
  cohort: VideoMatchInput[];
  ideaCapturedAt: Date;
  latestSuccessfulSyncAt: Date | null;
  now: Date;
  staleDays: number;
  weights?: MatchPairWeights;
}): VideoIdeaPairScore {
  const weights = input.weights ?? DEFAULT_MATCH_PAIR_WEIGHTS;
  const align = alignmentScore(input.video.title, input.idea);
  const studio = studioSignalScore(input.idea);
  const analytics = analyticsScore(input.video, input.cohort);
  const fresh = freshScore({
    ideaCapturedAt: input.ideaCapturedAt,
    latestSuccessfulSyncAt: input.latestSuccessfulSyncAt,
    now: input.now,
    staleDays: input.staleDays,
  });
  const pairScore =
    weights.align * align +
    weights.studio * studio +
    weights.analytics * analytics +
    weights.fresh * fresh;
  return {
    sourceVideoId: input.video.id,
    ideaId: input.idea.id,
    pairScore,
    align,
    studio,
    analytics,
    fresh,
  };
}

export function rankVideoIdeaPairs(
  videos: VideoMatchInput[],
  ideas: InspirationIdea[],
  opts: {
    k: number;
    now: Date;
    latestSuccessfulSyncAt: Date | null;
    staleDays: number;
    ideaCapturedAtById: Record<string, Date>;
    weights?: MatchPairWeights;
  },
): VideoIdeaPairScore[] {
  const all: VideoIdeaPairScore[] = [];
  for (const video of videos) {
    for (const idea of ideas) {
      all.push(
        scoreVideoIdeaPair({
          video,
          idea,
          cohort: videos,
          ideaCapturedAt:
            opts.ideaCapturedAtById[idea.id] ?? opts.now,
          latestSuccessfulSyncAt: opts.latestSuccessfulSyncAt,
          now: opts.now,
          staleDays: opts.staleDays,
          weights: opts.weights,
        }),
      );
    }
  }
  all.sort((a, b) => b.pairScore - a.pairScore);
  const usedVideos = new Set<string>();
  const selected: VideoIdeaPairScore[] = [];
  for (const pair of all) {
    if (usedVideos.has(pair.sourceVideoId)) continue;
    selected.push(pair);
    usedVideos.add(pair.sourceVideoId);
    if (selected.length >= opts.k) break;
  }
  return selected;
}
