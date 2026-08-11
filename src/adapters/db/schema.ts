import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type {
  AnalyticsSnapshot,
  BrollPlanEntry,
  CandidateOrigin,
  ClipProvenance,
  GenerateProvenance,
  JobStatus,
  ReplayEvent,
  ReplayProvenance,
  ReplaySessionStatus,
} from "@/src/domain/entities";
import type { JobCheckpoint } from "@/src/domain/queue-control";
import type { CandidateStatus } from "@/src/domain/status";

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  youtubeChannelId: text("youtube_channel_id").notNull().unique(),
  title: text("title").notNull(),
  connectedAt: integer("connected_at", { mode: "timestamp" }).notNull(),
});

export const sourceVideos = sqliteTable("source_videos", {
  id: text("id").primaryKey(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id),
  youtubeVideoId: text("youtube_video_id").notNull().unique(),
  title: text("title").notNull(),
  durationSec: integer("duration_sec").notNull(),
  localMediaPath: text("local_media_path"),
  analyticsSnapshot: text("analytics_snapshot", {
    mode: "json",
  }).$type<AnalyticsSnapshot | null>(),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  syncedAt: integer("synced_at", { mode: "timestamp" }).notNull(),
});

export const generationBriefs = sqliteTable("generation_briefs", {
  id: text("id").primaryKey(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id),
  hook: text("hook").notNull(),
  script: text("script").notNull(),
  voiceProfile: text("voice_profile").notNull(),
  brollPlan: text("broll_plan", { mode: "json" })
    .$type<BrollPlanEntry[]>()
    .notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const shortCandidates = sqliteTable("short_candidates", {
  id: text("id").primaryKey(),
  origin: text("origin").$type<CandidateOrigin>().notNull(),
  status: text("status").$type<CandidateStatus>().notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
  score: real("score").notNull(),
  provenance: text("provenance", { mode: "json" })
    .$type<ClipProvenance | GenerateProvenance | ReplayProvenance>()
    .notNull(),
  renderOutputPath: text("render_output_path"),
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const replaySessions = sqliteTable("replay_sessions", {
  id: text("id").primaryKey(),
  rpyPath: text("rpy_path").notNull(),
  ibtPath: text("ibt_path"),
  mediaPath: text("media_path"),
  trackName: text("track_name"),
  focusCarIdx: integer("focus_car_idx"),
  title: text("title").notNull(),
  durationSec: integer("duration_sec"),
  status: text("status").$type<ReplaySessionStatus>().notNull(),
  events: text("events", { mode: "json" }).$type<ReplayEvent[]>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const renderJobs = sqliteTable("render_jobs", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id")
    .notNull()
    .references(() => shortCandidates.id)
    .unique(),
  status: text("status").$type<JobStatus>().notNull(),
  outputPath: text("output_path"),
  progressPct: integer("progress_pct").notNull(),
  message: text("message"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const publishJobs = sqliteTable("publish_jobs", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id")
    .notNull()
    .references(() => shortCandidates.id)
    .unique(),
  status: text("status").$type<JobStatus>().notNull(),
  youtubeVideoId: text("youtube_video_id"),
  uploadSessionUrl: text("upload_session_url"),
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const queueJobs = sqliteTable(
  "queue_jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    status: text("status").$type<JobStatus>().notNull(),
    position: integer("position").notNull(),
    progressPct: integer("progress_pct").notNull(),
    progressMessage: text("progress_message").notNull(),
    checkpoint: text("checkpoint", { mode: "json" }).$type<JobCheckpoint | null>(),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp" }),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    // Speeds up claimNext (status = 'queued' ORDER BY position) and reorder
    // scans, which run on every queue mutation.
    index("queue_jobs_status_position_idx").on(table.status, table.position),
  ],
);
