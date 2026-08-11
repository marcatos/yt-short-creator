import pino, { type Logger as PinoLogger } from "pino";

import type { LogLevel, Logger } from "@/src/ports/logger";

const SENSITIVE_KEY = /secret|token|password|api.?key/i;

const PINO_LEVEL: Record<LogLevel, pino.LevelWithSilent> = {
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
};

function sanitizeContext(
  ctx?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!ctx) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(ctx)) {
    if (SENSITIVE_KEY.test(key)) {
      sanitized[key] = "[REDACTED]";
      continue;
    }

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      sanitized[key] = sanitizeContext(value as Record<string, unknown>);
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

class PinoLoggerAdapter implements Logger {
  constructor(private readonly logger: PinoLogger) {}

  debug(msg: string, ctx?: Record<string, unknown>): void {
    this.logger.debug(sanitizeContext(ctx), msg);
  }

  info(msg: string, ctx?: Record<string, unknown>): void {
    this.logger.info(sanitizeContext(ctx), msg);
  }

  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.logger.warn(sanitizeContext(ctx), msg);
  }

  error(msg: string, ctx?: Record<string, unknown>): void {
    this.logger.error(sanitizeContext(ctx), msg);
  }

  child(ctx: Record<string, unknown>): Logger {
    return new PinoLoggerAdapter(this.logger.child(sanitizeContext(ctx) ?? {}));
  }
}

export function createLogger(logLevel: LogLevel = "INFO"): Logger {
  const isDev = process.env.NODE_ENV !== "production";

  const logger = pino({
    level: PINO_LEVEL[logLevel],
    ...(isDev
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:standard",
            },
          },
        }
      : {}),
  });

  return new PinoLoggerAdapter(logger);
}
