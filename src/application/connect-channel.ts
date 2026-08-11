import type { Channel } from "@/src/domain/entities";
import type { ChannelRepository } from "@/src/ports/channel-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { IdPort } from "@/src/ports/id";
import type { Logger } from "@/src/ports/logger";
import type { YouTubeAuthPort } from "@/src/ports/youtube-auth";
import type { YouTubeCatalogPort } from "@/src/ports/youtube-catalog";

type ConnectChannelDependencies = {
  auth: YouTubeAuthPort;
  catalog: YouTubeCatalogPort;
  channels: ChannelRepository;
  id: IdPort;
  clock: ClockPort;
  logger: Logger;
};

export type ConnectChannel = (code: string) => Promise<Channel>;

export function createConnectChannel({
  auth,
  catalog,
  channels,
  id,
  clock,
  logger,
}: ConnectChannelDependencies): ConnectChannel {
  const log = logger.child({ operation: "connectYouTubeChannel" });

  return async (code: string): Promise<Channel> => {
    const startedAt = performance.now();
    log.info("YouTube channel connection started");

    try {
      const tokens = await auth.exchangeCode(code);
      await auth.saveTokens(tokens);
      log.debug("YouTube OAuth tokens stored");

      const info = await catalog.getChannelInfo(tokens.accessToken);
      const existing = await channels.getByYoutubeChannelId(
        info.youtubeChannelId,
      );
      const channel: Channel = {
        id: existing?.id ?? id.generate(),
        youtubeChannelId: info.youtubeChannelId,
        title: info.title,
        connectedAt: clock.now(),
      };

      await channels.save(channel);
      log.info("YouTube channel connection completed", {
        channelId: channel.id,
        youtubeChannelId: channel.youtubeChannelId,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return channel;
    } catch (error) {
      log.error("YouTube channel connection failed", {
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error),
        durationMs: Math.round(performance.now() - startedAt),
      });
      throw error;
    }
  };
}
