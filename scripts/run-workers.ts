/**
 * Dedicated job-worker process (FFmpeg / YouTube / analysis).
 *
 * Run beside Next so localhost stays responsive:
 *   Terminal A: npm run dev
 *   Terminal B: npm run workers
 */
import fs from "node:fs";
import path from "node:path";

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

async function main(): Promise<void> {
  loadEnvLocal();
  process.env.WORKER_PROCESS = "1";

  const { loadEnv } = await import("../src/lib/env");
  loadEnv();

  const { getContainer, startWorkers } = await import("../src/lib/container");
  const container = getContainer();
  const log = container.logger.child({ component: "WorkerProcess" });

  log.info("Starting dedicated worker process", {
    pid: process.pid,
    databasePath: process.env.DATABASE_PATH ?? "./data/app.db",
    mediaRoot: process.env.MEDIA_ROOT ?? "./media",
  });

  startWorkers();
  log.info("Workers running; waiting for jobs (Ctrl+C to stop)");

  const shutdown = (signal: string) => {
    log.info("Worker process shutting down", { signal });
    try {
      container.connection.close();
    } catch (error) {
      log.warn("Error closing DB on shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Keep the event loop alive for the runner's claimNext waits.
  await new Promise(() => {});
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
