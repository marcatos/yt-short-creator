export type VideoDownloadOptions = {
  signal?: AbortSignal;
};

export interface VideoDownloadPort {
  download(
    youtubeVideoId: string,
    options?: VideoDownloadOptions,
  ): Promise<string>;
}
