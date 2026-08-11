export type WaitForNewRecordingInput = {
  watchDir: string;
  since: Date;
  timeoutMs: number;
};

export interface ReplayCapturePort {
  defaultVideosDir(): string;
  waitForNewRecording(input: WaitForNewRecordingInput): Promise<string>;
}
