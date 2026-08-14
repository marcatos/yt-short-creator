import { desc, eq, inArray } from "drizzle-orm";

import type { AppDb } from "@/src/adapters/db/client";
import {
  candidateInspirationLinks,
  inspirationIdeas,
  inspirationSyncRuns,
} from "@/src/adapters/db/schema";
import type {
  CandidateInspirationLink,
  InspirationIdeaRecord,
  InspirationStorePort,
  InspirationSyncRun,
} from "@/src/ports/inspiration-store";

type SyncRunRow = typeof inspirationSyncRuns.$inferSelect;
type IdeaRow = typeof inspirationIdeas.$inferSelect;
type LinkRow = typeof candidateInspirationLinks.$inferSelect;

function toSyncRun(row: SyncRunRow): InspirationSyncRun {
  return {
    id: row.id,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status: row.status,
    ideaCount: row.ideaCount,
    errorMessage: row.errorMessage,
    source: row.source,
  };
}

function toIdeaRecord(row: IdeaRow): InspirationIdeaRecord {
  return {
    id: row.id,
    syncRunId: row.syncRunId,
    externalKey: row.externalKey,
    title: row.title,
    summary: row.summary,
    audienceInterest: row.audienceInterest,
    channelAlignment: row.channelAlignment,
    relatedInterest: row.relatedInterest ?? null,
    outline: row.outline,
    suggestedTitles: row.suggestedTitles,
    thumbnailNotes: row.thumbnailNotes,
    rawSnippet: row.rawSnippet,
    capturedAt: row.capturedAt,
    active: row.active,
  };
}

function toLink(row: LinkRow): CandidateInspirationLink {
  return {
    candidateId: row.candidateId,
    ideaId: row.ideaId,
    alignmentScore: row.alignmentScore,
  };
}

function ideaInsertValues(syncRunId: string, idea: InspirationIdeaRecord) {
  return {
    id: idea.id,
    syncRunId,
    externalKey: idea.externalKey,
    title: idea.title,
    summary: idea.summary,
    audienceInterest: idea.audienceInterest,
    channelAlignment: idea.channelAlignment,
    relatedInterest: idea.relatedInterest,
    outline: idea.outline,
    suggestedTitles: idea.suggestedTitles,
    thumbnailNotes: idea.thumbnailNotes,
    rawSnippet: idea.rawSnippet,
    capturedAt: idea.capturedAt,
    active: true,
  };
}

export class DrizzleInspirationStore implements InspirationStorePort {
  constructor(private readonly db: AppDb) {}

  async saveSyncRun(run: InspirationSyncRun): Promise<void> {
    await this.db
      .insert(inspirationSyncRuns)
      .values({
        id: run.id,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        status: run.status,
        ideaCount: run.ideaCount,
        errorMessage: run.errorMessage,
        source: run.source,
      })
      .onConflictDoUpdate({
        target: inspirationSyncRuns.id,
        set: {
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          status: run.status,
          ideaCount: run.ideaCount,
          errorMessage: run.errorMessage,
          source: run.source,
        },
      });
  }

  async listSyncRuns(limit: number): Promise<InspirationSyncRun[]> {
    if (limit <= 0) {
      return [];
    }
    const rows = await this.db
      .select()
      .from(inspirationSyncRuns)
      .orderBy(desc(inspirationSyncRuns.startedAt))
      .limit(limit);
    return rows.map(toSyncRun);
  }

  async getLatestOkSyncAt(): Promise<Date | null> {
    return this.latestSyncAt(["ok"]);
  }

  async getLatestSuccessfulSyncAt(): Promise<Date | null> {
    return this.latestSyncAt(["ok", "partial"]);
  }

  async getLatestFinishedSyncAt(): Promise<Date | null> {
    return this.latestSyncAt(["ok", "partial", "failed"]);
  }

  private async latestSyncAt(
    statuses: Array<InspirationSyncRun["status"]>,
  ): Promise<Date | null> {
    const rows = await this.db
      .select()
      .from(inspirationSyncRuns)
      .where(
        statuses.length === 1
          ? eq(inspirationSyncRuns.status, statuses[0]!)
          : inArray(inspirationSyncRuns.status, statuses),
      )
      .orderBy(
        desc(inspirationSyncRuns.finishedAt),
        desc(inspirationSyncRuns.startedAt),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return row.finishedAt ?? row.startedAt;
  }

  async replaceActiveIdeas(
    syncRunId: string,
    ideas: InspirationIdeaRecord[],
  ): Promise<void> {
    this.db.transaction((tx) => {
      tx.update(inspirationIdeas)
        .set({ active: false })
        .where(eq(inspirationIdeas.active, true))
        .run();
      if (ideas.length === 0) {
        return;
      }
      tx.insert(inspirationIdeas)
        .values(ideas.map((idea) => ideaInsertValues(syncRunId, idea)))
        .run();
    });
  }

  async listActiveIdeas(): Promise<InspirationIdeaRecord[]> {
    const rows = await this.db
      .select()
      .from(inspirationIdeas)
      .where(eq(inspirationIdeas.active, true))
      .orderBy(desc(inspirationIdeas.capturedAt));
    return rows.map(toIdeaRecord);
  }

  async deleteLinksForCandidates(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const uniqueIds = [...new Set(ids)];
    await this.db
      .delete(candidateInspirationLinks)
      .where(inArray(candidateInspirationLinks.candidateId, uniqueIds));
  }

  async saveCandidateLinks(links: CandidateInspirationLink[]): Promise<void> {
    if (links.length === 0) {
      return;
    }
    await this.db.insert(candidateInspirationLinks).values(
      links.map((link) => ({
        candidateId: link.candidateId,
        ideaId: link.ideaId,
        alignmentScore: link.alignmentScore,
      })),
    );
  }

  async listLinksForCandidates(
    ids: string[],
  ): Promise<CandidateInspirationLink[]> {
    if (ids.length === 0) {
      return [];
    }
    const uniqueIds = [...new Set(ids)];
    const rows = await this.db
      .select()
      .from(candidateInspirationLinks)
      .where(inArray(candidateInspirationLinks.candidateId, uniqueIds));
    return rows.map(toLink);
  }
}
