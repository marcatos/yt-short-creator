export type ProxyFrame = {
  /** Milliseconds from media start. */
  timeMs: number;
  path: string;
};

export type MediaProxyResult = {
  proxyVideoPath: string;
  audioPath: string;
  framesDir: string;
  frames: ProxyFrame[];
  durationSec: number;
  reused: boolean;
};

export type EnsureMediaProxyInput = {
  mediaPath: string;
  outDir: string;
  /** Seconds between sampled JPEG frames (default 2). */
  frameIntervalSec?: number;
};

export interface MediaProxyPort {
  ensureProxy(input: EnsureMediaProxyInput): Promise<MediaProxyResult>;
}
