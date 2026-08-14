import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";

import { createDb } from "@/src/adapters/db/client";
import * as schema from "@/src/adapters/db/schema";
import { createSqliteJobQueue } from "@/src/adapters/jobs/sqlite-queue";
import { SystemClock } from "@/src/adapters/system/clock";
import { UuidIdPort } from "@/src/adapters/system/id";
import type { Logger } from "@/src/ports/logger";

function createTestLogger(): Logger {
  const noop = () => {};
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
  };
  return logger;
}

describe("database migrations", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("upgrades a database migrated only through 0001 with queue_jobs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-upgrade-"));
    dirs.push(dir);
    const legacyMigrations = path.join(dir, "legacy-migrations");
    const legacyMeta = path.join(legacyMigrations, "meta");
    fs.mkdirSync(legacyMeta, { recursive: true });

    for (const migration of ["0000_warm_vivisector.sql", "0001_replay_sessions.sql"]) {
      fs.copyFileSync(
        path.join(process.cwd(), "drizzle", migration),
        path.join(legacyMigrations, migration),
      );
    }
    const journal = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8"),
    ) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 2);
    fs.writeFileSync(
      path.join(legacyMeta, "_journal.json"),
      JSON.stringify(journal),
      "utf8",
    );

    const dbPath = path.join(dir, "upgrade.db");
    const legacySqlite = new Database(dbPath);
    migrate(drizzle(legacySqlite, { schema }), { migrationsFolder: legacyMigrations });
    legacySqlite.close();

    const current = createDb(dbPath);
    const queue = createSqliteJobQueue({
      db: current.db,
      logger: createTestLogger(),
      idPort: new UuidIdPort(),
      clock: new SystemClock(),
    });

    await expect(queue.enqueue({ type: "render", payload: {} })).resolves.toEqual(
      expect.any(String),
    );
    expect(
      current.db.all<{ name: string }>(
        // This assertion verifies the migration outcome independently of enqueue.
        "select name from sqlite_master where type = 'table' and name = 'queue_jobs'",
      ),
    ).toEqual([{ name: "queue_jobs" }]);
    current.close();
  });

  it("creates inspiration tables on a fresh migrate", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-inspiration-"));
    dirs.push(dir);
    const current = createDb(path.join(dir, "fresh.db"));
    try {
      const names = current.db
        .all<{ name: string }>(
          "select name from sqlite_master where type = 'table' and name in ('inspiration_sync_runs', 'inspiration_ideas', 'candidate_inspiration_links') order by name",
        )
        .map((row) => row.name);

      expect(names).toEqual([
        "candidate_inspiration_links",
        "inspiration_ideas",
        "inspiration_sync_runs",
      ]);
    } finally {
      current.close();
    }
  });
});
