import type { ProxyFrame } from "@/src/ports/media-proxy";
import type { RaceHudTimeline } from "@/src/domain/race-hud";

export type RaceHudExtractInput = {
  frames: ProxyFrame[];
  /** Directory for optional ROI crop artifacts. */
  workDir: string;
};

/**
 * Extracts structured burned-in HUD overlays (session strip, focus card,
 * battle/relative, standings) from proxy JPEG frames.
 */
export interface RaceHudExtractorPort {
  extract(input: RaceHudExtractInput): Promise<RaceHudTimeline>;
}
