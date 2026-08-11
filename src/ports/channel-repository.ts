import type { Channel } from "@/src/domain/entities";

export interface ChannelRepository {
  save(channel: Channel): Promise<void>;
  getById(id: string): Promise<Channel | null>;
  getByYoutubeChannelId(
    youtubeChannelId: string,
  ): Promise<Channel | null>;
  list(): Promise<Channel[]>;
}
