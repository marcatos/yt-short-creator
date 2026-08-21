import type { InstagramAccount } from "@/src/domain/entities";
import type { ClockPort } from "@/src/ports/clock";
import type { IdPort } from "@/src/ports/id";
import type { InstagramAccountRepository } from "@/src/ports/instagram-account-repository";
import type { InstagramAuthPort } from "@/src/ports/instagram-auth";
import type { Logger } from "@/src/ports/logger";
import { fetchInstagramUsername } from "@/src/adapters/instagram/oauth";

type Dependencies = {
  auth: InstagramAuthPort;
  accounts: InstagramAccountRepository;
  id: IdPort;
  clock: ClockPort;
  logger: Logger;
};

export type ConnectInstagram = (code: string) => Promise<InstagramAccount>;

export function createConnectInstagram(deps: Dependencies): ConnectInstagram {
  const log = deps.logger.child({ operation: "connectInstagram" });

  return async (code: string) => {
    const startedAt = performance.now();
    log.info("Instagram connection started");
    try {
      const tokens = await deps.auth.exchangeCode(code);
      await deps.auth.saveTokens(tokens);

      const username = await fetchInstagramUsername(
        tokens.igUserId,
        tokens.pageAccessToken,
      );
      const existing = await deps.accounts.get();
      const account: InstagramAccount = {
        id: existing?.id ?? deps.id.generate(),
        igUserId: tokens.igUserId,
        username,
        pageId: tokens.pageId,
        pageName: tokens.pageName,
        connectedAt: deps.clock.now(),
      };
      await deps.accounts.save(account);

      log.info("Instagram connection completed", {
        accountId: account.id,
        igUserId: account.igUserId,
        username: account.username,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return account;
    } catch (error) {
      log.error("Instagram connection failed", {
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
