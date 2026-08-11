import type { LogLevel } from "./logger";

export type DefaultPrivacy = "public" | "unlisted" | "private";

export type AppSettings = {
  brandRoot: string;
  logLevel: LogLevel;
  defaultPrivacy: DefaultPrivacy;
};

export interface SettingsRepository {
  get(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<void>;
}
