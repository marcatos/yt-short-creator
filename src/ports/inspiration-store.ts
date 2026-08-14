export type InspirationSyncStatus = "ok" | "partial" | "failed";
export type InspirationSyncSource = "manual" | "scheduled";

export type InspirationSyncRun = {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: InspirationSyncStatus;
  ideaCount: number;
  errorMessage: string | null;
  source: InspirationSyncSource;
};

/**
 * Persisted Inspiration snapshot. Domain `InspirationIdea` is the bias/match
 * subset (id, title, summary, suggestedTitles, outline, optional chips).
 */
export type InspirationIdeaRecord = {
  id: string;
  syncRunId: string;
  externalKey: string;
  title: string;
  summary: string;
  audienceInterest: string | null;
  channelAlignment: string | null;
  relatedInterest: unknown | null;
  outline: string | null;
  suggestedTitles: string[];
  thumbnailNotes: string | null;
  rawSnippet: string | null;
  capturedAt: Date;
  active: boolean;
};

export type CandidateInspirationLink = {
  candidateId: string;
  ideaId: string;
  alignmentScore: number;
};

export interface InspirationStorePort {
  saveSyncRun(run: InspirationSyncRun): Promise<void>;
  listSyncRuns(limit: number): Promise<InspirationSyncRun[]>;
  getLatestOkSyncAt(): Promise<Date | null>;
  /** Latest finished sync with status `ok` or `partial` (successful snapshots). */
  getLatestSuccessfulSyncAt(): Promise<Date | null>;
  replaceActiveIdeas(
    syncRunId: string,
    ideas: InspirationIdeaRecord[],
  ): Promise<void>;
  listActiveIdeas(): Promise<InspirationIdeaRecord[]>;
  deleteLinksForCandidates(ids: string[]): Promise<void>;
  saveCandidateLinks(links: CandidateInspirationLink[]): Promise<void>;
  listLinksForCandidates(ids: string[]): Promise<CandidateInspirationLink[]>;
}
