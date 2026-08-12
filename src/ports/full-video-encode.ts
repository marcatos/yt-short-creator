export type FullVideoEncodeInput = {
  sourceMediaPath: string;
  outputPath: string;
  /** Cap long edge (default 2560 = keep 1440p from 2K masters). */
  maxWidth?: number;
  /** Target average video bitrate in Mbps (YouTube 1440p60 ≈ 20–24). */
  targetBitrateMbps?: number;
  maxBitrateMbps?: number;
};

export type FullVideoEncodeResult = {
  outputPath: string;
  reused: boolean;
  width: number;
  height: number;
  fps: number;
  videoBitrateMbps: number;
  encoderLabel: string;
  durationMs: number;
};

export interface FullVideoEncodePort {
  encode(input: FullVideoEncodeInput): Promise<FullVideoEncodeResult>;
}
