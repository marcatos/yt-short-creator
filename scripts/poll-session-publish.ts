/**
 * Poll replay session publish progress until done or timeout.
 * Usage: npx tsx scripts/poll-session-publish.ts --session-id <uuid> [--timeout-min 180]
 */
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const sessionId = argValue("--session-id");
  if (!sessionId) throw new Error("Missing --session-id");
  const timeoutMin = Math.max(5, Number(argValue("--timeout-min") ?? "180") || 180);
  const deadline = Date.now() + timeoutMin * 60_000;
  const dbPath = path.resolve("data/app.db");
  const db = new Database(dbPath);

  while (Date.now() < deadline) {
    const session = db
      .prepare(
        "select status, full_video_youtube_id from replay_sessions where id = ?",
      )
      .get(sessionId) as
      | { status: string; full_video_youtube_id: string | null }
      | undefined;
    const pending = (
      db
        .prepare(
          "select count(*) as c from queue_jobs where status in ('queued','running','paused')",
        )
        .get() as { c: number }
    ).c;
    const shorts = db
      .prepare(
        "select status, count(*) as c from short_candidates where provenance like ? group by status",
      )
      .all(`%${sessionId}%`) as Array<{ status: string; c: number }>;
    const failed = db
      .prepare(
        "select id, type, error from queue_jobs where status = 'failed' order by updated_at desc limit 5",
      )
      .all() as Array<{ id: string; type: string; error: string | null }>;

    const published =
      shorts.find((row) => row.status === "published")?.c ?? 0;
    const summary = {
      at: new Date().toISOString(),
      sessionStatus: session?.status ?? null,
      fullVideoYoutubeId: session?.full_video_youtube_id ?? null,
      pendingJobs: pending,
      shorts,
      published,
      failed,
    };
    console.log(JSON.stringify(summary));

    if (
      pending === 0 &&
      session?.full_video_youtube_id &&
      published >= 5
    ) {
      console.log("ALL_DONE");
      db.close();
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }

  db.close();
  throw new Error(`Timeout after ${timeoutMin} minutes`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
