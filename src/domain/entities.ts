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
