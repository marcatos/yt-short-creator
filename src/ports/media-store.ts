export interface MediaStorePort {
  sourcePath(youtubeVideoId: string): string;
  renderPath(candidateId: string): string;
  audioPath(candidateId: string): string;
  voPath(candidateId: string, language: "it" | "en"): string;
  writeText?(filePath: string, content: string): Promise<void>;
  brollPath(filename: string): string;
  /** Analysis artifacts dir for a replay session (proxy, frames, audio). */
  replayAnalysisDir(sessionId: string): string;
  /** YouTube-delivery encode of the full race for a session. */
  fullReplayEncodePath(sessionId: string): string;
  listBroll(): Promise<string[]>;
  ensureDirs(): Promise<void>;
}
