import type { CandidateStatus } from "./status";

export type CandidateOrigin = "clip" | "generate" | "replay";

export type ClipCrop = {
  mode: "center_vertical" | "face_track";
  focusX: number;
};

export type ClipProvenance = {
  sourceVideoId: string;
  startMs: number;
  endMs: number;
  hookReason: string;
  crop: ClipCrop;
};

export type GenerateTimelineEntry = {
  asset: string;
  startMs: number;
  endMs: number;
};

export type GenerateProvenance = {
  generationBriefId: string;
  scriptVersion: number;
  voiceAssetPath: string;
  timeline: GenerateTimelineEntry[];
};

export const REPLAY_SESSION_STATUSES = [
  "draft",
  "capturing",
  "ready",
  "analyzing",
  "failed",
] as const;

export type ReplaySessionStatus = (typeof REPLAY_SESSION_STATUSES)[number];

export const REPLAY_EVENT_TYPES = [
  "incident",
  "overtake",
  "best_lap",
  "manual",
  "llm_moment",
] as const;

export type ReplayEventType = (typeof REPLAY_EVENT_TYPES)[number];

export type ReplayEvent = {
  id: string;
  type: ReplayEventType;
  startMs: number;
  endMs: number;
  score: number;
  title?: string;
  hookReason: string;
  payload?: Record<string, unknown>;
};

export type ReplaySession = {
  id: string;
  rpyPath: string;
  ibtPath: string | null;
  mediaPath: string | null;
  trackName: string | null;
  focusCarIdx: number | null;
  title: string;
  durationSec: number | null;
  status: ReplaySessionStatus;
  events: ReplayEvent[];
  createdAt: Date;
  updatedAt: Date;
};

export type ReplayProvenance = {
  replaySessionId: string;
  startMs: number;
  endMs: number;
  hookReason: string;
  eventType: ReplayEventType;
  crop: ClipCrop;
};

export type ShortCandidate = {
  id: string;
  origin: CandidateOrigin;
  status: CandidateStatus;
  title: string;
  description: string;
  tags: string[];
  score: number;
  provenance: ClipProvenance | GenerateProvenance | ReplayProvenance;
  /** Set when render succeeds; required to retry upload after publish failure. */
  renderOutputPath: string | null;
  scheduledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Channel = {
  id: string;
  youtubeChannelId: string;
  title: string;
  connectedAt: Date;
};

export type AnalyticsSnapshot = Record<string, unknown>;

export type SourceVideo = {
  id: string;
  channelId: string;
  youtubeVideoId: string;
  title: string;
  durationSec: number;
  localMediaPath: string | null;
  analyticsSnapshot: AnalyticsSnapshot | null;
  publishedAt: Date | null;
  syncedAt: Date;
};

export type BrollPlanEntry = {
  asset: string;
  description: string;
};

export type GenerationBrief = {
  id: string;
  channelId: string;
  hook: string;
  script: string;
  voiceProfile: string;
  brollPlan: BrollPlanEntry[];
  createdAt: Date;
};

export const JOB_STATUSES = [
  "queued",
  "running",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export type RenderJob = {
  id: string;
  candidateId: string;
  status: JobStatus;
  outputPath: string | null;
  progressPct: number;
  message: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PublishJob = {
  id: string;
  candidateId: string;
  status: JobStatus;
  youtubeVideoId: string | null;
  uploadSessionUrl: string | null;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
