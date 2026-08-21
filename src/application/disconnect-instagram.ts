import type { InstagramAccountRepository } from "@/src/ports/instagram-account-repository";
import type { InstagramAuthPort } from "@/src/ports/instagram-auth";
import type { Logger } from "@/src/ports/logger";

type Dependencies = {
  auth: InstagramAuthPort;
  accounts: InstagramAccountRepository;
  logger: Logger;
};

export type DisconnectInstagram = () => Promise<void>;

export function createDisconnectInstagram(
  deps: Dependencies,
): DisconnectInstagram {
  const log = deps.logger.child({ operation: "disconnectInstagram" });

  return async () => {
    const startedAt = performance.now();
    log.info("Instagram disconnect started");
    try {
      await deps.auth.clearTokens();
      await deps.accounts.delete();
      log.info("Instagram disconnect completed", {
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      log.error("Instagram disconnect failed", {
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
