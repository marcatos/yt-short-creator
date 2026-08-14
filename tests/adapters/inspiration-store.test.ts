import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDb } from "@/src/adapters/db/client";
import { createRepositories } from "@/src/adapters/db/repositories";
import type { ShortCandidate } from "@/src/domain/entities";
import type {
  InspirationIdeaRecord,
  InspirationSyncRun,
} from "@/src/ports/inspiration-store";

const tempConnections: Array<{ dbPath: string; close: () => void }> = [];

function openTempDb() {
  const dbPath = path.join(
    os.tmpdir(),
    `yt-short-creator-inspiration-${crypto.randomUUID()}.db`,
  );
  const connection = createDb(dbPath);
  tempConnections.push({ dbPath, close: connection.close });
  return connection;
}

afterEach(() => {
  for (const connection of tempConnections.splice(0)) {
    connection.close();
    fs.rmSync(connection.dbPath, { force: true });
    fs.rmSync(`${connection.dbPath}-wal`, { force: true });
    fs.rmSync(`${connection.dbPath}-shm`, { force: true });
  }
});

const t0 = new Date("2026-08-14T10:00:00.000Z");
const t1 = new Date("2026-08-14T11:00:00.000Z");
const t2 = new Date("2026-08-14T12:00:00.000Z");

function syncRun(
  overrides: Partial<InspirationSyncRun> & Pick<InspirationSyncRun, "id">,
): InspirationSyncRun {
  return {
    startedAt: t0,
    finishedAt: t1,
    status: "ok",
    ideaCount: 1,
    errorMessage: null,
    source: "manual",
    ...overrides,
  };
}

function idea(
  overrides: Partial<InspirationIdeaRecord> &
    Pick<InspirationIdeaRecord, "id" | "syncRunId">,
): InspirationIdeaRecord {
  return {
    externalKey: `ext-${overrides.id}`,
    title: "Brake later into T1",
    summary: "Studio idea about trail braking at Oschersleben.",
    audienceInterest: "sim racing",
    channelAlignment: "high",
    relatedInterest: { videos: ["abc"] },
    outline: "Hook, mistake, fix.",
    suggestedTitles: ["Brake later", "T1 secret"],
    thumbnailNotes: "helmet cam",
    rawSnippet: "card html…",
    capturedAt: t1,
    active: true,
    ...overrides,
  };
}

const sampleCandidate: ShortCandidate = {
  id: "cand-1",
  origin: "clip",
  status: "proposed",
  title: "Best Overtake",
  description: "Short clip",
  tags: ["racing"],
  score: 0.9,
  provenance: {
    sourceVideoId: "sv-1",
    startMs: 1000,
    endMs: 4000,
    hookReason: "peak",
    crop: { mode: "center_vertical", focusX: 0.5 },
  },
  renderOutputPath: null,
  voiceOvers: null,
  scheduledAt: null,
  createdAt: t0,
  updatedAt: t0,
};

describe("InspirationStore", () => {
  it("creates inspiration tables on migrate", () => {
    const { db } = openTempDb();
    const names = db
      .all<{ name: string }>(
        "select name from sqlite_master where type = 'table' and name in ('inspiration_sync_runs', 'inspiration_ideas', 'candidate_inspiration_links') order by name",
      )
      .map((row) => row.name);

    expect(names).toEqual([
      "candidate_inspiration_links",
      "inspiration_ideas",
      "inspiration_sync_runs",
    ]);
  });

  it("replaceActiveIdeas leaves only the new set active", async () => {
    const { db } = openTempDb();
    const store = createRepositories(db).inspiration;

    await store.saveSyncRun(syncRun({ id: "run-1", ideaCount: 2 }));
    await store.replaceActiveIdeas("run-1", [
      idea({ id: "idea-old-a", syncRunId: "run-1", title: "Old A" }),
      idea({ id: "idea-old-b", syncRunId: "run-1", title: "Old B" }),
    ]);

    await store.saveSyncRun(syncRun({ id: "run-2", startedAt: t1, finishedAt: t2, ideaCount: 1 }));
    await store.replaceActiveIdeas("run-2", [
      idea({
        id: "idea-new",
        syncRunId: "run-2",
        title: "New idea",
        capturedAt: t2,
      }),
    ]);

    const active = await store.listActiveIdeas();
    expect(active.map((row) => row.id)).toEqual(["idea-new"]);
    expect(active.every((row) => row.active)).toBe(true);
    expect(active[0]?.syncRunId).toBe("run-2");
  });

  it("replaceActiveIdeas with an empty list deactivates every previous idea", async () => {
    const { db } = openTempDb();
    const store = createRepositories(db).inspiration;

    await store.saveSyncRun(syncRun({ id: "run-1" }));
    await store.replaceActiveIdeas("run-1", [
      idea({ id: "idea-1", syncRunId: "run-1" }),
    ]);
    await store.saveSyncRun(syncRun({ id: "run-2", ideaCount: 0 }));
    await store.replaceActiveIdeas("run-2", []);

    expect(await store.listActiveIdeas()).toEqual([]);
  });

  it("round-trips sync runs, newest first, and latest ok finishedAt", async () => {
    const { db } = openTempDb();
    const store = createRepositories(db).inspiration;

    const failed = syncRun({
      id: "run-failed",
      status: "failed",
      ideaCount: 0,
      errorMessage: "studio ui missing",
      source: "scheduled",
      startedAt: t0,
      finishedAt: t0,
    });
    const partial = syncRun({
      id: "run-partial",
      status: "partial",
      ideaCount: 2,
      startedAt: t1,
      finishedAt: t1,
    });
    const ok = syncRun({
      id: "run-ok",
      status: "ok",
      ideaCount: 9,
      startedAt: t2,
      finishedAt: t2,
    });

    await store.saveSyncRun(failed);
    await store.saveSyncRun(partial);
    await store.saveSyncRun(ok);

    expect(await store.listSyncRuns(2)).toEqual([ok, partial]);
    expect(await store.getLatestOkSyncAt()).toEqual(t2);
    expect(await store.getLatestSuccessfulSyncAt()).toEqual(t2);
  });

  it("getLatestOkSyncAt is null when no ok sync exists", async () => {
    const { db } = openTempDb();
    const store = createRepositories(db).inspiration;

    await store.saveSyncRun(
      syncRun({ id: "run-failed", status: "failed", ideaCount: 0, finishedAt: t1 }),
    );

    expect(await store.getLatestOkSyncAt()).toBeNull();
    expect(await store.getLatestSuccessfulSyncAt()).toBeNull();
  });

  it("getLatestSuccessfulSyncAt includes partial when no ok sync exists", async () => {
    const { db } = openTempDb();
    const store = createRepositories(db).inspiration;

    await store.saveSyncRun(
      syncRun({
        id: "run-failed",
        status: "failed",
        ideaCount: 0,
        finishedAt: t0,
      }),
    );
    await store.saveSyncRun(
      syncRun({
        id: "run-partial",
        status: "partial",
        ideaCount: 2,
        finishedAt: t1,
      }),
    );

    expect(await store.getLatestOkSyncAt()).toBeNull();
    expect(await store.getLatestSuccessfulSyncAt()).toEqual(t1);
  });

  it("getLatestFinishedSyncAt includes failed follow-up runs", async () => {
    const { db } = openTempDb();
    const store = createRepositories(db).inspiration;

    await store.saveSyncRun(
      syncRun({
        id: "run-ok",
        status: "ok",
        ideaCount: 9,
        finishedAt: t0,
      }),
    );
    await store.saveSyncRun(
      syncRun({
        id: "run-failed",
        status: "failed",
        ideaCount: 0,
        errorMessage: "studio ui missing",
        source: "scheduled",
        startedAt: t1,
        finishedAt: t1,
      }),
    );

    expect(await store.getLatestOkSyncAt()).toEqual(t0);
    expect(await store.getLatestSuccessfulSyncAt()).toEqual(t0);
    expect(await store.getLatestFinishedSyncAt()).toEqual(t1);
  });

  it("persists idea snapshot fields on listActiveIdeas", async () => {
    const { db } = openTempDb();
    const store = createRepositories(db).inspiration;
    const record = idea({
      id: "idea-1",
      syncRunId: "run-1",
      audienceInterest: null,
      channelAlignment: null,
      relatedInterest: null,
      outline: null,
      thumbnailNotes: null,
      rawSnippet: null,
      suggestedTitles: [],
    });

    await store.saveSyncRun(syncRun({ id: "run-1" }));
    await store.replaceActiveIdeas("run-1", [record]);

    expect(await store.listActiveIdeas()).toEqual([{ ...record, active: true }]);
  });

  it("saves and lists candidate inspiration links", async () => {
    const { db } = openTempDb();
    const repos = createRepositories(db);
    const store = repos.inspiration;

    await repos.candidates.save(sampleCandidate);
    await repos.candidates.save({ ...sampleCandidate, id: "cand-2" });
    await store.saveSyncRun(syncRun({ id: "run-1" }));
    await store.replaceActiveIdeas("run-1", [
      idea({ id: "idea-1", syncRunId: "run-1" }),
      idea({ id: "idea-2", syncRunId: "run-1", title: "Other" }),
    ]);

    await store.saveCandidateLinks([
      { candidateId: "cand-1", ideaId: "idea-1", alignmentScore: 0.42 },
      { candidateId: "cand-2", ideaId: "idea-2", alignmentScore: 0.81 },
    ]);

    const links = await store.listLinksForCandidates(["cand-2", "cand-1", "missing"]);
    expect(links).toEqual(
      expect.arrayContaining([
        { candidateId: "cand-1", ideaId: "idea-1", alignmentScore: 0.42 },
        { candidateId: "cand-2", ideaId: "idea-2", alignmentScore: 0.81 },
      ]),
    );
    expect(links).toHaveLength(2);
    expect(await store.listLinksForCandidates([])).toEqual([]);
  });

  it("replaces existing links for the same candidate ids", async () => {
    const { db } = openTempDb();
    const repos = createRepositories(db);
    const store = repos.inspiration;

    await repos.candidates.save(sampleCandidate);
    await store.saveSyncRun(syncRun({ id: "run-1" }));
    await store.replaceActiveIdeas("run-1", [
      idea({ id: "idea-1", syncRunId: "run-1" }),
      idea({ id: "idea-2", syncRunId: "run-1", title: "Other" }),
    ]);

    await store.saveCandidateLinks([
      { candidateId: "cand-1", ideaId: "idea-1", alignmentScore: 0.42 },
    ]);
    await store.deleteLinksForCandidates(["cand-1"]);
    await store.saveCandidateLinks([
      { candidateId: "cand-1", ideaId: "idea-2", alignmentScore: 0.9 },
    ]);

    expect(await store.listLinksForCandidates(["cand-1"])).toEqual([
      { candidateId: "cand-1", ideaId: "idea-2", alignmentScore: 0.9 },
    ]);
  });
});
