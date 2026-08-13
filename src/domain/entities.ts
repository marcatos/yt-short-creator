import type { RaceAnalysis } from "./race-analysis";
import type { CandidateStatus } from "./status";
import type { VoiceOverPackage } from "./voice-over";
import type { DeliveryAssetBundle } from "./youtube-metadata";

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

export type RaceTimelineEntry = {
  startMs: number;
  endMs: number;
  summary: string;
  involvingFocusCar: boolean;
};

export type RaceFullVideoMetadata = {
  title: string;
  description: string;
  tags: string[];
};

export type RacePackage = {
  focusCarHint: string;
  transcript: string;
  timeline: RaceTimelineEntry[];
  fullVideo: RaceFullVideoMetadata;
  audioTranscript: string;
};

export const DEFAULT_FOCUS_CAR_HINT =
  "White/black/green livery with pi / π mark (S.Marcato 42 Racing); hero car for all moments";

export type YoutubePrivacy = "public" | "unlisted" | "private";

export type ReplaySession = {
  id: string;
  /** Null for OBS / media-only sessions. */
  rpyPath: string | null;
  ibtPath: string | null;
  mediaPath: string | null;
  trackName: string | null;
  focusCarIdx: number | null;
  title: string;
  durationSec: number | null;
  status: ReplaySessionStatus;
  events: ReplayEvent[];
  /** @deprecated Prefer raceAnalysis; kept for legacy VO/publish bridges. */
  racePackage: RacePackage | null;
  /** Structured FASE A analysis (verified facts + storylines + Short scores). */
  raceAnalysis?: RaceAnalysis | null;
  /** Local YouTube-delivery encode of the full race (sensible bitrate). */
  fullVideoEncodePath: string | null;
  fullVideoYoutubeId: string | null;
  fullVideoPrivacy: YoutubePrivacy | null;
  fullVideoPublishedAt: Date | null;
  /** Bilingual narration packages for the full-race upload. */
  fullVoiceOvers?: VoiceOverPackage[] | null;
  /** Packaged multi-language delivery assets (single-master model). */
  deliveryAssets?: DeliveryAssetBundle | null;
  /**
   * Remaining Studio steps after best-effort API publish
   * (e.g. attach secondary audio track).
   */
  publishManualChecklist?: string[] | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ReplaySegment = {
  startMs: number;
  endMs: number;
};

export type ReplayProvenance = {
  replaySessionId: string;
  startMs: number;
  endMs: number;
  hookReason: string;
  eventType: ReplayEventType;
  crop: ClipCrop;
  /** Optional multi-scene montage windows (total 8–60s). */
  segments?: ReplaySegment[];
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
  voiceOvers?: VoiceOverPackage[] | null;
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

export type AnalyticsSnapshot = {
  viewCount: number;
  likeCount: number;
  commentCount: number;
};

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
