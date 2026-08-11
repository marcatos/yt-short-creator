import { describe, expect, it } from "vitest";

import {
  createGetSettings,
  createUpdateSettings,
  maskSecret,
} from "@/src/application/settings";
import type {
  AppSettings,
  SettingsRepository,
} from "@/src/ports/settings-repository";
import type { Logger } from "@/src/ports/logger";

const defaults: AppSettings = {
  brandRoot: "C:/brands/smarcato42-racing",
  logLevel: "INFO",
  defaultPrivacy: "public",
};

const noop = () => {};
const logger: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  child: () => logger,
};

function memorySettingsRepository(): SettingsRepository {
  let settings = defaults;
  return {
    get: async () => settings,
    save: async (next) => {
      settings = next;
    },
  };
}

describe("settings use cases", () => {
  it("returns settings with masked secret indicators", async () => {
    const getSettings = createGetSettings({
      settings: memorySettingsRepository(),
      secrets: {
        youtubeClientSecret: "youtube-secret",
        llmApiKey: "",
        ttsApiKey: "tts-secret",
      },
      logger,
    });

    await expect(getSettings()).resolves.toEqual({
      ...defaults,
      secrets: {
        youtubeClientSecret: "••••cret",
        llmApiKey: "Not configured",
        ttsApiKey: "••••cret",
      },
    });
  });

  it("updates only editable non-secret settings", async () => {
    const settings = memorySettingsRepository();
    const updateSettings = createUpdateSettings({ settings, logger });

    await updateSettings({
      brandRoot: "D:/brand",
      logLevel: "DEBUG",
      defaultPrivacy: "private",
    });

    await expect(settings.get()).resolves.toEqual({
      brandRoot: "D:/brand",
      logLevel: "DEBUG",
      defaultPrivacy: "private",
    });
  });

  it("does not reveal short secrets", () => {
    expect(maskSecret("abc")).toBe("••••");
  });
});
