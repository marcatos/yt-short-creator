export interface MediaStorePort {
  sourcePath(youtubeVideoId: string): string;
  renderPath(candidateId: string): string;
  audioPath(candidateId: string): string;
  brollPath(filename: string): string;
  /** Analysis artifacts dir for a replay session (proxy, frames, audio). */
  replayAnalysisDir(sessionId: string): string;
  listBroll(): Promise<string[]>;
  ensureDirs(): Promise<void>;
}
