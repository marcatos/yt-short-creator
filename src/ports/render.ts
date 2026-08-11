import type { ClipCrop, GenerateTimelineEntry } from "@/src/domain/entities";

export type RenderInput = {
  candidateId: string;
  origin: "clip" | "generate";
  sourceMediaPath: string;
  outputPath: string;
  startMs?: number;
  endMs?: number;
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

export interface RenderPort {
  render(input: RenderInput): Promise<RenderResult>;
}
