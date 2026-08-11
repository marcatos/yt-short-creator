import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const dbPath = path.resolve("data/app.db");
console.log("dbPath", dbPath, "exists", fs.existsSync(dbPath));

const db = new Database(dbPath);
console.log(
  "tables",
  db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),
);
console.log(
  "candidates",
  db
    .prepare(
      "SELECT id, origin, status, title, substr(description,1,80) AS description FROM short_candidates",
    )
    .all(),
);
console.log("publish_jobs", db.prepare("SELECT * FROM publish_jobs").all());
console.log(
  "source_videos",
  db
    .prepare("SELECT id, youtube_video_id, title FROM source_videos LIMIT 20")
    .all(),
);
