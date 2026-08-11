import type { CandidateStatus } from "./status";

export type CandidateOrigin = "clip" | "generate";

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

export type ShortCandidate = {
  id: string;
  origin: CandidateOrigin;
  status: CandidateStatus;
  title: string;
  description: string;
  tags: string[];
  score: number;
  provenance: ClipProvenance | GenerateProvenance;
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
