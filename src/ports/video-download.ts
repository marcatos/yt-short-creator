export interface VideoDownloadPort {
  download(youtubeVideoId: string): Promise<string>;
}
