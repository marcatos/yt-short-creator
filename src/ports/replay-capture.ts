export type WaitForNewRecordingInput = {
  watchDir: string;
  since: Date;
  timeoutMs: number;
};

export type AutoCaptureInput = {
  rpyPath: string;
  watchDir: string;
  timeoutMs: number;
  /** Wall-clock recording length. Defaults from playSpeed × content length when known. */
  recordDurationMs?: number;
  /** Replay playback speed while recording (1 = realtime). */
  playSpeed?: number;
};

export type DirectedShotInput = {
  id: string;
  /** Session time ms to seek; use -1 to jump via NextIncident search. */
  seekMs: number;
  recordMs: number;
  carPosition: number;
  cameraGroup: number;
  cameraNumber: number;
};

export type DirectedCaptureInput = {
  rpyPath: string;
  watchDir: string;
  timeoutMs: number;
  shots: DirectedShotInput[];
  outputPath: string;
  playSpeed?: number;
};

export type DirectedCaptureResult = {
  mediaPath: string;
  segments: Array<{
    shotId: string;
    path: string;
    durationMs: number;
  }>;
};

export interface ReplayCapturePort {
  defaultVideosDir(): string;
  waitForNewRecording(input: WaitForNewRecordingInput): Promise<string>;
  /** Open the .rpy, drive iRacing playback, and start/stop in-sim video capture. */
  autoCapture(input: AutoCaptureInput): Promise<string>;
  /**
   * Event-driven director capture: seek/cam-switch per shot, record segments,
   * concatenate into a highlight reel.
   */
  directedCapture(input: DirectedCaptureInput): Promise<DirectedCaptureResult>;
}
