import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDb } from "@/src/adapters/db/client";
import { createRepositories } from "@/src/adapters/db/repositories";
import type {
  Channel,
  GenerationBrief,
  PublishJob,
  RenderJob,
  ReplaySession,
  ShortCandidate,
  SourceVideo,
} from "@/src/domain/entities";

const tempConnections: Array<{ dbPath: string; close: () => void }> = [];

function openTempDb() {
  const dbPath = path.join(
    os.tmpdir(),
    `yt-short-creator-test-${crypto.randomUUID()}.db`,
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

const now = new Date("2026-08-11T10:00:00.000Z");

const sampleChannel: Channel = {
  id: "ch-1",
  youtubeChannelId: "UC_test",
  title: "S.Marcato 42 Racing",
  connectedAt: now,
};

const sampleSourceVideo: SourceVideo = {
  id: "sv-1",
  channelId: "ch-1",
  youtubeVideoId: "yt-vid-1",
  title: "Race Highlights",
  durationSec: 600,
  localMediaPath: "media/sources/sv-1.mp4",
  analyticsSnapshot: { viewCount: 1200, likeCount: 10, commentCount: 2 },
  publishedAt: now,
  syncedAt: now,
};

const sampleBrief: GenerationBrief = {
  id: "gb-1",
  channelId: "ch-1",
  hook: "Did you know?",
  script: "Full script text",
  voiceProfile: "italian-male-1",
  brollPlan: [{ asset: "broll_1.mp4", description: "pit lane" }],
  createdAt: now,
};

const sampleCandidate: ShortCandidate = {
  id: "cand-1",
  origin: "clip",
  status: "proposed",
  title: "Best Overtake",
  description: "Short clip",
  tags: ["racing", "shorts"],
  score: 0.92,
  provenance: {
    sourceVideoId: "sv-1",
    startMs: 10000,
    endMs: 25000,
    hookReason: "peak action",
    crop: { mode: "center_vertical", focusX: 0.5 },
  },
  renderOutputPath: null,
  voiceOvers: [
    {
      language: "it",
      script: "Guarda questo sorpasso!",
      title: "Sorpasso migliore",
      description: "Il momento decisivo della gara.",
      voiceProfile: "coral",
      audioPath: "media/voice-overs/cand-1/vo-it.mp3",
      words: [{ text: "Guarda", startMs: 0, endMs: 350 }],
      srtPath: "media/voice-overs/cand-1/vo-it.srt",
      assPath: "media/voice-overs/cand-1/vo-it.ass",
      scriptHash: "hash-it",
    },
  ],
  scheduledAt: null,
  createdAt: now,
  updatedAt: now,
};

const sampleReplaySession: ReplaySession = {
  id: "rs-1",
  rpyPath: null,
  ibtPath: null,
  mediaPath: "C:/Videos/race.mkv",
  commentaryPath: null,
  commentaryOffsetMs: 0,
  trackName: "Oschersleben",
  focusCarIdx: 42,
  title: "Endurance race",
  durationSec: 3_600,
  status: "ready",
  events: [],
  racePackage: {
    focusCarHint: "pi",
    transcript: "Gara",
    timeline: [
      { startMs: 0, endMs: 60_000, summary: "Partenza", involvingFocusCar: true },
    ],
    fullVideo: { title: "Gara completa", description: "Desc", tags: ["iRacing"] },
    audioTranscript: "",
  },
  fullVideoEncodePath: "media/replays/rs-1/full-youtube.mp4",
  fullVideoYoutubeId: null,
  fullVideoPrivacy: "unlisted",
  fullVideoPublishedAt: null,
  fullVoiceOvers: [
    {
      language: "it",
      script: "Benvenuti alla gara.",
      title: "Gara completa IT",
      description: "Narrazione italiana.",
      voiceProfile: "coral",
      audioPath: "media/replays/rs-1/vo-it.mp3",
      words: [{ text: "Benvenuti", startMs: 0, endMs: 420 }],
      srtPath: "media/replays/rs-1/vo-it.srt",
      assPath: null,
      scriptHash: "hash-full-it",
      renderOutputPath: "media/replays/rs-1/full-youtube-it.mp4",
      youtubeVideoId: "yt-full-it",
      youtubeCaptionId: "caption-full-it",
    },
  ],
  raceAnalysis: null,
  deliveryAssets: null,
  publishManualChecklist: null,
  createdAt: now,
  updatedAt: now,
};

const sampleRenderJob: RenderJob = {
  id: "rj-1",
  candidateId: "cand-1",
  status: "queued",
  outputPath: null,
  progressPct: 0,
  message: null,
  createdAt: now,
  updatedAt: now,
};

const samplePublishJob: PublishJob = {
  id: "pj-1",
  candidateId: "cand-1",
  status: "queued",
  youtubeVideoId: null,
  uploadSessionUrl: null,
  scheduledAt: null,
  publishedAt: null,
  createdAt: now,
  updatedAt: now,
};

describe("Drizzle repositories", () => {
  it("persists and reads all entity types", async () => {
    const { db } = openTempDb();
    const repos = createRepositories(db);

    await repos.channels.save(sampleChannel);
    await repos.sourceVideos.save(sampleSourceVideo);
    await repos.generationBriefs.save(sampleBrief);
    await repos.candidates.save(sampleCandidate);
    await repos.jobs.saveRenderJob(sampleRenderJob);
    await repos.jobs.savePublishJob(samplePublishJob);

    expect(await repos.channels.getById("ch-1")).toEqual(sampleChannel);
    expect(await repos.channels.getByYoutubeChannelId("UC_test")).toEqual(
      sampleChannel,
    );
    expect(await repos.sourceVideos.getById("sv-1")).toEqual(
      sampleSourceVideo,
    );
    expect(await repos.sourceVideos.getByYoutubeVideoId("yt-vid-1")).toEqual(
      sampleSourceVideo,
    );
    expect(await repos.generationBriefs.getById("gb-1")).toEqual(sampleBrief);
    expect(await repos.candidates.getById("cand-1")).toEqual(sampleCandidate);
    expect(await repos.jobs.getRenderJobById("rj-1")).toEqual(sampleRenderJob);
    expect(await repos.jobs.getPublishJobById("pj-1")).toEqual(
      samplePublishJob,
    );
    expect(await repos.jobs.getRenderJobByCandidateId("cand-1")).toEqual(
      sampleRenderJob,
    );
    expect(await repos.jobs.getPublishJobByCandidateId("cand-1")).toEqual(
      samplePublishJob,
    );
  });

  it("round-trips replay sessions including full-race voice-overs", async () => {
    const { db } = openTempDb();
    const repos = createRepositories(db);

    await repos.replaySessions.save(sampleReplaySession);

    expect(await repos.replaySessions.getById("rs-1")).toEqual(
      sampleReplaySession,
    );
  });

  it("lists and filters candidates", async () => {
    const { db } = openTempDb();
    const repos = createRepositories(db);

    await repos.channels.save(sampleChannel);
    await repos.candidates.save(sampleCandidate);
    await repos.candidates.save({
      ...sampleCandidate,
      id: "cand-2",
      origin: "generate",
      status: "approved",
      provenance: {
        generationBriefId: "gb-1",
        scriptVersion: 1,
        voiceAssetPath: "media/audio/v1.mp3",
        timeline: [{ asset: "broll_1.mp4", startMs: 0, endMs: 3000 }],
      },
    });

    expect(await repos.candidates.list({})).toHaveLength(2);
    expect(await repos.candidates.list({ status: "proposed" })).toHaveLength(1);
    expect(await repos.candidates.list({ origin: "generate" })).toHaveLength(1);
  });

  it("upserts source videos in bulk", async () => {
    const { db } = openTempDb();
    const repos = createRepositories(db);

    await repos.channels.save(sampleChannel);
    await repos.sourceVideos.upsertMany([sampleSourceVideo]);

    const updated: SourceVideo = {
      ...sampleSourceVideo,
      title: "Updated Title",
      durationSec: 720,
    };
    await repos.sourceVideos.upsertMany([updated]);

    expect(await repos.sourceVideos.listByChannelId("ch-1")).toEqual([updated]);
  });

  it("deletes source videos by id", async () => {
    const { db } = openTempDb();
    const repos = createRepositories(db);

    await repos.channels.save(sampleChannel);
    await repos.sourceVideos.upsertMany([
      sampleSourceVideo,
      { ...sampleSourceVideo, id: "sv-2", youtubeVideoId: "yt-vid-2" },
    ]);

    await repos.sourceVideos.deleteByIds(["sv-1"]);

    expect(await repos.sourceVideos.listByChannelId("ch-1")).toEqual([
      { ...sampleSourceVideo, id: "sv-2", youtubeVideoId: "yt-vid-2" },
    ]);
  });

  it("creates parent data directory when missing", () => {
    const dbPath = path.join(
      os.tmpdir(),
      `yt-short-creator-nested-${crypto.randomUUID()}`,
      "nested",
      "app.db",
    );
    const connection = createDb(dbPath);
    tempConnections.push({ dbPath, close: connection.close });

    expect(fs.existsSync(path.dirname(dbPath))).toBe(true);
  });
});
