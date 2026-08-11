export interface MediaStorePort {
  sourcePath(youtubeVideoId: string): string;
  renderPath(candidateId: string): string;
  audioPath(candidateId: string): string;
  brollPath(filename: string): string;
  ensureDirs(): Promise<void>;
}
