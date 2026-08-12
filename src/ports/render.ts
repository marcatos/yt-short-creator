import type {
  ClipCrop,
  GenerateTimelineEntry,
  ReplaySegment,
} from "@/src/domain/entities";

export type RenderInput = {
  candidateId: string;
  origin: "clip" | "generate" | "replay";
  sourceMediaPath: string;
  outputPath: string;
  startMs?: number;
  endMs?: number;
  /** Multi-scene montage for replay/clip shorts. */
  segments?: ReplaySegment[];
  crop?: ClipCrop;
  voiceAssetPath?: string;
  timeline?: GenerateTimelineEntry[];
  logoPath: string;
  accentColor: string;
  burnInCaptions?: boolean;
};

export type RenderResult = {
  outputPath: string;
};

export type RenderOptions = {
  signal?: AbortSignal;
};

export interface RenderPort {
  render(input: RenderInput, options?: RenderOptions): Promise<RenderResult>;
}
