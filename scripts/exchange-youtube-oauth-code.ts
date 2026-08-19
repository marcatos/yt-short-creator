/**
 * Exchange a one-shot YouTube OAuth code and store tokens (local recovery).
 *
 * Usage:
 *   npx tsx scripts/exchange-youtube-oauth-code.ts --code "4/...."
 */
import fs from "node:fs";
import path from "node:path";

import { loadEnv } from "../src/lib/env";
import { createContainer } from "../src/lib/container";

function loadEnvLocal(): void {
  const envPath = path.resolve(".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env) || !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  loadEnvLocal();
  const code = argValue("--code");
  if (!code) throw new Error('Missing --code "..."');

  const container = createContainer(loadEnv());
  const started = performance.now();
  container.logger.info("Exchanging YouTube OAuth code", {
    codeChars: code.length,
  });

  const channel = await container.connectChannel(code);
  await container.syncChannel(channel.id);

  const tokens = await container.auth.getStoredTokens();
  container.logger.info("YouTube OAuth exchange completed", {
    channelId: channel.id,
    title: channel.title,
    hasTokens: Boolean(tokens),
    expiresAt: tokens?.expiresAt.toISOString() ?? null,
    durationMs: Math.round(performance.now() - started),
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        channelId: channel.id,
        title: channel.title,
        expiresAt: tokens?.expiresAt.toISOString() ?? null,
      },
      null,
      2,
    ),
  );
  container.connection.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
