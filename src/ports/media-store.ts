export interface MediaStorePort {
  sourcePath(youtubeVideoId: string): string;
  renderPath(candidateId: string): string;
  voRenderPath?(candidateId: string, language: "it" | "en"): string;
  voPublishCheckpointPath?(
    candidateId: string,
    language: "it" | "en",
  ): string;
  audioPath(candidateId: string): string;
  voPath?(candidateId: string, language: "it" | "en"): string;
  readText?(filePath: string): Promise<string | null>;
  writeText?(filePath: string, content: string): Promise<void>;
  brollPath(filename: string): string;
  /** Analysis artifacts dir for a replay session (proxy, frames, audio). */
  replayAnalysisDir(sessionId: string): string;
  /** YouTube-delivery encode of the full race for a session. */
  fullReplayEncodePath(sessionId: string): string;
  /** Narration audio for one language of a full-race session. */
  fullReplayVoPath?(sessionId: string, language: "it" | "en"): string;
  /** Delivery encode with the narration mixed in, per language. */
  fullReplayVoRenderPath?(sessionId: string, language: "it" | "en"): string;
  /** Durable publish result for one language of a full-race session. */
  fullVoPublishCheckpointPath?(
    sessionId: string,
    language: "it" | "en",
  ): string;
  listBroll(): Promise<string[]>;
  ensureDirs(): Promise<void>;
}
