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

export interface ReplayCapturePort {
  defaultVideosDir(): string;
  waitForNewRecording(input: WaitForNewRecordingInput): Promise<string>;
  /** Open the .rpy, drive iRacing playback, and start/stop in-sim video capture. */
  autoCapture(input: AutoCaptureInput): Promise<string>;
}
