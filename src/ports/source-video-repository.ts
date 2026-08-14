import type { SourceVideo } from "@/src/domain/entities";

export interface SourceVideoRepository {
  save(video: SourceVideo): Promise<void>;
  getById(id: string): Promise<SourceVideo | null>;
  getByYoutubeVideoId(
    youtubeVideoId: string,
  ): Promise<SourceVideo | null>;
  listByChannelId(channelId: string): Promise<SourceVideo[]>;
  upsertMany(videos: SourceVideo[]): Promise<void>;
  deleteByIds(ids: string[]): Promise<void>;
}
