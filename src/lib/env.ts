import { z } from "zod";

import type { LogLevel } from "@/src/ports/logger";

const logLevelSchema = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]);

const envSchema = z.object({
  LOG_LEVEL: logLevelSchema.default("INFO"),
  BRAND_ROOT: z.string().min(1),
  YOUTUBE_CLIENT_ID: z.string().default(""),
  YOUTUBE_CLIENT_SECRET: z.string().default(""),
  YOUTUBE_REDIRECT_URI: z.string().url(),
  LLM_API_KEY: z.string().default(""),
  LLM_BASE_URL: z.string().url(),
  LLM_MODEL: z.string().min(1),
  WHISPER_MODEL: z.string().min(1).default("whisper-1"),
  TTS_API_KEY: z.string().default(""),
  TTS_BASE_URL: z.string().url(),
  TTS_MODEL: z.string().min(1),
  DATABASE_PATH: z.string().min(1),
  MEDIA_ROOT: z.string().min(1),
  IRACING_VIDEOS_DIR: z.string().optional().default(""),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse({
    LOG_LEVEL: source.LOG_LEVEL,
    BRAND_ROOT: source.BRAND_ROOT,
    YOUTUBE_CLIENT_ID: source.YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET: source.YOUTUBE_CLIENT_SECRET,
    YOUTUBE_REDIRECT_URI: source.YOUTUBE_REDIRECT_URI,
    LLM_API_KEY: source.LLM_API_KEY,
    LLM_BASE_URL: source.LLM_BASE_URL,
    LLM_MODEL: source.LLM_MODEL,
    WHISPER_MODEL: source.WHISPER_MODEL,
    TTS_API_KEY: source.TTS_API_KEY,
    TTS_BASE_URL: source.TTS_BASE_URL,
    TTS_MODEL: source.TTS_MODEL,
    DATABASE_PATH: source.DATABASE_PATH,
    MEDIA_ROOT: source.MEDIA_ROOT,
    IRACING_VIDEOS_DIR: source.IRACING_VIDEOS_DIR,
  });
}

export type { LogLevel };
