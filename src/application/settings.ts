import type { Logger } from "@/src/ports/logger";
import type {
  AppSettings,
  SettingsRepository,
} from "@/src/ports/settings-repository";

type SecretValues = {
  youtubeClientSecret: string;
  llmApiKey: string;
  ttsApiKey: string;
};

export type SettingsView = AppSettings & {
  secrets: Record<keyof SecretValues, string>;
};

export function maskSecret(secret: string): string {
  if (!secret) return "Not configured";
  if (secret.length <= 4) return "••••";
  return `••••${secret.slice(-4)}`;
}

export function createGetSettings(deps: {
  settings: SettingsRepository;
  secrets: SecretValues;
  logger: Logger;
}): () => Promise<SettingsView> {
  const log = deps.logger.child({ operation: "getSettings" });
  return async () => {
    const startedAt = performance.now();
    log.info("Settings read started");
    try {
      const settings = await deps.settings.get();
      const result = {
        ...settings,
        secrets: {
          youtubeClientSecret: maskSecret(deps.secrets.youtubeClientSecret),
          llmApiKey: maskSecret(deps.secrets.llmApiKey),
          ttsApiKey: maskSecret(deps.secrets.ttsApiKey),
        },
      };
      log.info("Settings read completed", {
        durationMs: Math.round(performance.now() - startedAt),
      });
      return result;
    } catch (error) {
      log.error("Settings read failed", {
        durationMs: Math.round(performance.now() - startedAt),
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  };
}

export function createUpdateSettings(deps: {
  settings: SettingsRepository;
  logger: Logger;
}): (input: AppSettings) => Promise<AppSettings> {
  const log = deps.logger.child({ operation: "updateSettings" });
  return async (input) => {
    const startedAt = performance.now();
    log.info("Settings update started");
    try {
      const updated: AppSettings = {
        brandRoot: input.brandRoot.trim(),
        logLevel: input.logLevel,
        defaultPrivacy: input.defaultPrivacy,
      };
      if (!updated.brandRoot) throw new Error("Brand path must not be empty");
      await deps.settings.save(updated);
      log.info("Settings update completed", {
        logLevel: updated.logLevel,
        defaultPrivacy: updated.defaultPrivacy,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return updated;
    } catch (error) {
      log.error("Settings update failed", {
        durationMs: Math.round(performance.now() - startedAt),
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  };
}
