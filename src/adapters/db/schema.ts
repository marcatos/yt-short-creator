import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type {
  AnalyticsSnapshot,
  BrollPlanEntry,
  CandidateOrigin,
  ClipProvenance,
  GenerateProvenance,
  JobStatus,
} from "@/src/domain/entities";
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
    .$type<ClipProvenance | GenerateProvenance>()
    .notNull(),
  renderOutputPath: text("render_output_path"),
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }),
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
