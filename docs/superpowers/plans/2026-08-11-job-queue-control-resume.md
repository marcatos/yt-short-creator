# Job Queue Control + Durable Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make worker jobs pausable (soft), cancellable (hard), reorderable, and durable across app restarts with per-step checkpoints.

**Architecture:** Replace the in-memory FIFO queue with a SQLite-backed `queue_jobs` table as source of truth. Extend the worker runner with per-job `AbortController` + cooperative pause flags. Handlers become step-based and idempotent via `saveCheckpoint`. Boot recovery resets orphan `running` → `queued` (checkpoint kept) and repairs candidate pipeline orphans.

**Tech Stack:** Next.js 15, Drizzle + SQLite (`better-sqlite3`), Vitest, existing hexagonal ports/adapters, pino logging.

**Spec:** [docs/superpowers/specs/2026-08-11-job-queue-control-resume-design.md](../specs/2026-08-11-job-queue-control-resume-design.md)

## Global Constraints

- Personal repo (`Documents\Projects`) → `marcatos`, public, Conventional Commits (`feat`/`fix`/`test`/`refactor`/`docs`).
- Hexagonal: domain has no framework/IO; adapters implement ports.
- Logging: DEBUG/INFO/WARN/ERROR with timings/`jobId`/`type`/`step`; never log secrets.
- Files ideally ≤300 lines; split when exceeding.
- Pause = soft between steps; Cancel = hard abort; Resume = explicit only.
- Single worker concurrency remains `1`.
- CI artifacts (if any): `retention-days: 7`.

---

## File map

```
src/domain/entities.ts              # add "paused" to JOB_STATUSES
src/domain/queue-control.ts         # NEW: checkpoint type, JobPausedError, JobCancelledError, step helpers
src/ports/job-queue.ts              # extend public + DurableJobQueue surface
src/ports/render.ts                 # optional AbortSignal on render()
src/ports/video-download.ts         # optional AbortSignal on download()
src/adapters/db/schema.ts           # queueJobs table
drizzle/0002_queue_jobs.sql         # migration (via drizzle-kit generate)
src/adapters/jobs/job-record.ts     # NEW: JobRecord type shared by adapters
src/adapters/jobs/sqlite-queue.ts   # NEW: durable queue
src/adapters/jobs/in-process-queue.ts # keep for fast tests; implement same DurableJobQueue API
src/workers/runner.ts               # abort + pause + checkpoint wiring
src/workers/handlers.ts             # step checkpoints
src/workers/publish-short-handler.ts
src/adapters/ffmpeg/ffmpeg-render.ts
src/adapters/media/ytdlp-download.ts
src/application/recover-queue.ts    # NEW: orphan candidate repair
src/lib/container.ts                # wire sqlite queue + recoverOnBoot
app/api/jobs/route.ts               # list (+ checkpoint fields)
app/api/jobs/reorder/route.ts       # NEW
app/api/jobs/[id]/pause/route.ts    # NEW
app/api/jobs/[id]/resume/route.ts   # NEW
app/api/jobs/[id]/cancel/route.ts   # NEW
app/api/jobs/[id]/move/route.ts     # NEW
app/api/jobs/[id]/progress/route.ts
app/components/JobProgress.tsx      # controls + full-list poll
app/jobs/page.tsx
tests/domain/queue-control.test.ts
tests/adapters/sqlite-queue.test.ts
tests/adapters/job-queue.test.ts    # update for DurableJobQueue + pause/cancel
tests/workers/runner-control.test.ts
tests/workers/handler-checkpoints.test.ts
tests/application/recover-queue.test.ts
```

---

### Task 1: Domain — paused status + queue-control helpers

**Files:**
- Modify: `src/domain/entities.ts` (`JOB_STATUSES`)
- Create: `src/domain/queue-control.ts`
- Test: `tests/domain/queue-control.test.ts`

**Interfaces:**
- Produces: `JobCheckpoint`, `JobPausedError`, `JobCancelledError`, `isJobPausedError`, `isJobCancelledError`, `checkpointReached(checkpoint, step)`, `QUEUE_CONTROL_STEPS` map

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/queue-control.test.ts
import { describe, expect, it } from "vitest";
import {
  JobCancelledError,
  JobPausedError,
  checkpointReached,
  isJobCancelledError,
  isJobPausedError,
} from "@/src/domain/queue-control";

describe("queue-control", () => {
  it("recognizes pause and cancel errors", () => {
    expect(isJobPausedError(new JobPausedError())).toBe(true);
    expect(isJobCancelledError(new JobCancelledError())).toBe(true);
    expect(isJobPausedError(new Error("nope"))).toBe(false);
  });

  it("checkpointReached is true only after listed step", () => {
    expect(checkpointReached(null, "prepare")).toBe(false);
    expect(checkpointReached({ step: "prepare" }, "prepare")).toBe(true);
    expect(checkpointReached({ step: "prepare" }, "render")).toBe(false);
    expect(checkpointReached({ step: "render" }, "prepare")).toBe(true);
    expect(checkpointReached({ step: "enqueue_publish" }, "render")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/domain/queue-control.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Implement domain**

In `src/domain/entities.ts`, add `"paused"` to `JOB_STATUSES` (after `"running"`).

Create `src/domain/queue-control.ts`:

```ts
export type JobCheckpoint = {
  step: string;
  data?: unknown;
};

export class JobPausedError extends Error {
  readonly code = "JOB_PAUSED" as const;
  constructor(message = "Job paused") {
    super(message);
    this.name = "JobPausedError";
  }
}

export class JobCancelledError extends Error {
  readonly code = "JOB_CANCELLED" as const;
  constructor(message = "Job cancelled") {
    super(message);
    this.name = "JobCancelledError";
  }
}

export function isJobPausedError(error: unknown): error is JobPausedError {
  return error instanceof JobPausedError;
}

export function isJobCancelledError(error: unknown): error is JobCancelledError {
  return error instanceof JobCancelledError;
}

/** Ordered steps per job type (last completed step name stored in checkpoint). */
export const QUEUE_JOB_STEPS: Record<string, readonly string[]> = {
  sync_channel: ["run"],
  download_source_video: ["download"],
  analyze_clips: ["run"],
  analyze_replay: ["run"],
  ideate: ["run"],
  capture_replay: ["capture"],
  assemble_generate_preview: ["tts", "assemble"],
  render_short: ["prepare", "render", "enqueue_publish"],
  publish_short: ["prepare", "upload"],
};

export function checkpointReached(
  checkpoint: JobCheckpoint | null | undefined,
  step: string,
  jobType?: string,
): boolean {
  if (!checkpoint?.step) return false;
  const steps =
    (jobType && QUEUE_JOB_STEPS[jobType]) ||
    Object.values(QUEUE_JOB_STEPS).find((list) => list.includes(step));
  if (!steps) {
    return checkpoint.step === step;
  }
  const doneIdx = steps.indexOf(checkpoint.step);
  const needIdx = steps.indexOf(step);
  if (doneIdx < 0 || needIdx < 0) return checkpoint.step === step;
  return doneIdx >= needIdx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/domain/queue-control.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/entities.ts src/domain/queue-control.ts tests/domain/queue-control.test.ts
git commit -m "feat(jobs): add paused status and checkpoint helpers"
```

---

### Task 2: DurableJobQueue port + JobRecord type

**Files:**
- Create: `src/adapters/jobs/job-record.ts`
- Modify: `src/ports/job-queue.ts`
- Modify: `src/adapters/jobs/in-process-queue.ts` (re-export JobRecord from job-record; stub new methods throwing `not implemented` temporarily OR implement enough for compile — prefer full in-memory implementation of new methods in Task 4; for this task only update types and make TypeScript compile by adding method stubs that throw)

**Interfaces:**
- Produces:

```ts
// src/adapters/jobs/job-record.ts
import type { JobStatus } from "@/src/domain/entities";
import type { JobCheckpoint } from "@/src/domain/queue-control";

export type JobRecord = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  position: number;
  progressPct: number;
  progressMessage: string;
  checkpoint: JobCheckpoint | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  updatedAt: Date;
};

// src/ports/job-queue.ts
export type JobProgressView = {
  pct: number;
  message: string;
  status: JobStatus;
  checkpointStep: string | null;
};

export interface JobQueuePort {
  enqueue(job: { type: string; payload: Record<string, unknown> }): Promise<string>;
  getProgress(jobId: string): Promise<JobProgressView | null>;
}

export interface DurableJobQueue extends JobQueuePort {
  claimNext(): Promise<JobRecord | null>;
  setProgress(jobId: string, pct: number, message: string): void;
  saveCheckpoint(jobId: string, step: string, data?: unknown): Promise<void>;
  markRunning(jobId: string): void;
  markSucceeded(jobId: string): void;
  markFailed(jobId: string, error: unknown): void;
  markPaused(jobId: string): void;
  markCancelled(jobId: string): void;
  requestPause(jobId: string): Promise<void>; // throws/rejects with status error code conceptually — return discriminated result preferred
  resume(jobId: string): Promise<void>;
  cancel(jobId: string): Promise<"cancelled" | "aborting" | "noop">;
  isPauseRequested(jobId: string): boolean;
  clearPauseRequest(jobId: string): void;
  attachAbortController(jobId: string, controller: AbortController): void;
  getAbortSignal(jobId: string): AbortSignal | null;
  clearAbortController(jobId: string): void;
  reorder(orderedIds: string[]): Promise<void>;
  move(jobId: string, to: "top" | "bottom"): Promise<void>;
  getJob(jobId: string): JobRecord | undefined;
  listJobs(): JobRecord[];
  recoverOnBoot(): Promise<{ requeuedRunning: number }>;
  waitForWork?(): never; // do not expose — keep internal
}
```

Use result objects for pause/resume to avoid HTTP coupling:

```ts
export type QueueMutationResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "conflict"; message: string };
```

`requestPause` / `resume` return `QueueMutationResult`. `reorder` throws or returns `{ ok:false, code:"bad_request" }` if ids invalid.

- [ ] **Step 1: Add types and update `InProcessJobQueue` alias**

Change `export type InProcessJobQueue = DurableJobQueue` and implement new fields on `JobRecord` (`position`, `checkpoint`, `error`, `updatedAt`). Add stub methods that throw `new Error("Not implemented")` only if you split Task 4 — **prefer implementing in-memory fully in Task 3** and keep this task to port+record only with temporary casts if needed.

Minimal for this task: create `job-record.ts`, expand `job-queue.ts`, update imports in `in-process-queue.ts` / `runner.ts` / `container.ts` so the project still typechecks with existing methods plus `position: 0`, `checkpoint: null`, `error: null`, `updatedAt`.

- [ ] **Step 2: Run typecheck / existing tests**

Run: `npm test -- tests/adapters/job-queue.test.ts`
Expected: PASS (update list assertions if field shape changed; progress return type now includes `status` + `checkpointStep`)

Update `getProgress` return mapping in in-process queue:

```ts
return {
  pct: job.progressPct,
  message: job.progressMessage,
  status: job.status,
  checkpointStep: job.checkpoint?.step ?? null,
};
```

Update tests accordingly.

- [ ] **Step 3: Commit**

```bash
git add src/ports/job-queue.ts src/adapters/jobs/job-record.ts src/adapters/jobs/in-process-queue.ts tests/adapters/job-queue.test.ts
git commit -m "refactor(jobs): introduce DurableJobQueue and JobRecord fields"
```

---

### Task 3: In-process DurableJobQueue — pause, cancel, reorder, checkpoint

**Files:**
- Modify: `src/adapters/jobs/in-process-queue.ts`
- Modify: `tests/adapters/job-queue.test.ts`

**Interfaces:**
- Consumes: `DurableJobQueue`, `JobPausedError` (not thrown here — runner throws)
- Produces: full in-memory implementation used by runner/UI tests

- [ ] **Step 1: Write failing tests**

Append to `tests/adapters/job-queue.test.ts`:

```ts
it("claims by ascending position and supports reorder + move", async () => {
  const queue = createInProcessJobQueue({ logger: createTestLogger(), idPort: new UuidIdPort(), clock: new SystemClock() });
  const a = await queue.enqueue({ type: "t", payload: {} });
  const b = await queue.enqueue({ type: "t", payload: {} });
  const c = await queue.enqueue({ type: "t", payload: {} });
  await queue.reorder([c, a, b]);
  const first = await queue.claimNext();
  expect(first?.id).toBe(c);
});

it("pause request + markPaused; resume returns to queued", async () => {
  const queue = createInProcessJobQueue({ logger: createTestLogger(), idPort: new UuidIdPort(), clock: new SystemClock() });
  const id = await queue.enqueue({ type: "t", payload: {} });
  await queue.claimNext();
  queue.markRunning(id);
  const paused = await queue.requestPause(id);
  expect(paused.ok).toBe(true);
  expect(queue.isPauseRequested(id)).toBe(true);
  queue.markPaused(id);
  expect(queue.getJob(id)?.status).toBe("paused");
  const resumed = await queue.resume(id);
  expect(resumed.ok).toBe(true);
  expect(queue.getJob(id)?.status).toBe("queued");
});

it("cancel aborts running via AbortController", async () => {
  const queue = createInProcessJobQueue({ logger: createTestLogger(), idPort: new UuidIdPort(), clock: new SystemClock() });
  const id = await queue.enqueue({ type: "t", payload: {} });
  await queue.claimNext();
  queue.markRunning(id);
  const controller = new AbortController();
  queue.attachAbortController(id, controller);
  const result = await queue.cancel(id);
  expect(result).toBe("aborting");
  expect(controller.signal.aborted).toBe(true);
});

it("saveCheckpoint persists step", async () => {
  const queue = createInProcessJobQueue({ logger: createTestLogger(), idPort: new UuidIdPort(), clock: new SystemClock() });
  const id = await queue.enqueue({ type: "t", payload: {} });
  await queue.saveCheckpoint(id, "prepare", { foo: 1 });
  expect(queue.getJob(id)?.checkpoint).toEqual({ step: "prepare", data: { foo: 1 } });
});

it("recoverOnBoot requeues running jobs", async () => {
  const queue = createInProcessJobQueue({ logger: createTestLogger(), idPort: new UuidIdPort(), clock: new SystemClock() });
  const id = await queue.enqueue({ type: "t", payload: {} });
  await queue.claimNext();
  queue.markRunning(id);
  await queue.saveCheckpoint(id, "prepare");
  const { requeuedRunning } = await queue.recoverOnBoot();
  expect(requeuedRunning).toBe(1);
  expect(queue.getJob(id)?.status).toBe("queued");
  expect(queue.getJob(id)?.checkpoint?.step).toBe("prepare");
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- tests/adapters/job-queue.test.ts`

- [ ] **Step 3: Implement in-process methods**

Key behaviors:
- `pending` becomes ordered by `position` (assign `position = max+1` on enqueue).
- `claimNext`: pick lowest `position` among `status === "queued"` (scan map, not only pending array); wait/notify pattern kept.
- `reorder(orderedIds)`: must be exactly the set of current `queued`+`paused` ids; rewrite positions `0..n-1`; leave `running`/terminal positions alone (or use large gaps — simplest: recompute all non-terminal: running keeps relative slot, then orderedIds sequence for queued+paused).
  - Spec: reorder only queued+paused. Implementation: validate `orderedIds` matches all queued+paused ids as a set; assign positions starting after any `running` job’s position, or globally: assign `position = index` for orderedIds; running jobs keep their current position and must not appear in orderedIds.
- `move(id,"top"|"bottom")`: rebuild orderedIds of queued+paused and call reorder.
- `requestPause`: only if `running` → set flag in `Map<string, boolean>`; else `{ ok:false, code:"conflict" }`.
- `cancel`: queued/paused → `markCancelled`, return `"cancelled"`; running → abort controller if any, return `"aborting"` (runner will `markCancelled`); terminal → `"noop"`.
- `recoverOnBoot`: for each `running`, set `queued`, clear pause flag, clear abort controller, preserve checkpoint; re-notify waiter.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/adapters/jobs/in-process-queue.ts tests/adapters/job-queue.test.ts
git commit -m "feat(jobs): pause, cancel, reorder, and recover in in-process queue"
```

---

### Task 4: SQLite `queue_jobs` schema + durable adapter

**Files:**
- Modify: `src/adapters/db/schema.ts`
- Create: `src/adapters/jobs/sqlite-queue.ts`
- Generate: `drizzle/0002_*.sql` via `npm run db:generate`
- Test: `tests/adapters/sqlite-queue.test.ts`

**Interfaces:**
- Consumes: `DurableJobQueue`, `AppDb`, `ClockPort`, `IdPort`, `Logger`
- Produces: `createSqliteJobQueue(deps): DurableJobQueue`

- [ ] **Step 1: Add schema**

```ts
export const queueJobs = sqliteTable("queue_jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  status: text("status").$type<JobStatus>().notNull(),
  position: integer("position").notNull(),
  progressPct: integer("progress_pct").notNull(),
  progressMessage: text("progress_message").notNull(),
  checkpoint: text("checkpoint", { mode: "json" }).$type<JobCheckpoint | null>(),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  startedAt: integer("started_at", { mode: "timestamp" }),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

Run: `npm run db:generate`  
Then: `npm run db:migrate` (or rely on `createDb` migrator in tests).

- [ ] **Step 2: Failing persistence test**

```ts
// tests/adapters/sqlite-queue.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDb } from "@/src/adapters/db/client";
import { createSqliteJobQueue } from "@/src/adapters/jobs/sqlite-queue";
import { SystemClock } from "@/src/adapters/system/clock";
import { UuidIdPort } from "@/src/adapters/system/id";
import type { Logger } from "@/src/ports/logger";

function logger(): Logger {
  const noop = () => {};
  const l: Logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => l };
  return l;
}

describe("SqliteJobQueue", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("survives reopen with queued order and checkpoint", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "queue-"));
    dirs.push(dir);
    const dbPath = path.join(dir, "test.db");
    const conn1 = createDb(dbPath);
    const q1 = createSqliteJobQueue({
      db: conn1.db,
      logger: logger(),
      idPort: new UuidIdPort(),
      clock: new SystemClock(),
    });
    const id = await q1.enqueue({ type: "download_source_video", payload: { sourceVideoId: "s1" } });
    await q1.saveCheckpoint(id, "download", { path: "/tmp/x" });
    conn1.close();

    const conn2 = createDb(dbPath);
    const q2 = createSqliteJobQueue({
      db: conn2.db,
      logger: logger(),
      idPort: new UuidIdPort(),
      clock: new SystemClock(),
    });
    const job = q2.getJob(id);
    expect(job?.status).toBe("queued");
    expect(job?.checkpoint).toEqual({ step: "download", data: { path: "/tmp/x" } });
    const claimed = await q2.claimNext();
    expect(claimed?.id).toBe(id);
    conn2.close();
  });
});
```

- [ ] **Step 3: Implement `createSqliteJobQueue`**

Mirror in-process semantics. Keep **in-memory only**:
- pause-request flags
- AbortController map
- `wake` waiter for `claimNext`

All job fields persist to SQLite on every mutation (`enqueue`, progress, checkpoint, status, reorder).

`claimNext`: SQL `select ... where status='queued' order by position asc limit 1` after wait; then `markRunning` in same flow (or leave markRunning to runner as today).

`listJobs`: order active first — `running`, then `queued`/`paused` by position, then terminals by `updated_at` desc.

- [ ] **Step 4: Run tests PASS**

Run: `npm test -- tests/adapters/sqlite-queue.test.ts tests/adapters/job-queue.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/adapters/db/schema.ts src/adapters/jobs/sqlite-queue.ts drizzle tests/adapters/sqlite-queue.test.ts
git commit -m "feat(jobs): persist worker queue in SQLite"
```

---

### Task 5: Worker runner — AbortSignal, pause, checkpoint context

**Files:**
- Modify: `src/workers/handlers.ts` (`JobHandlerContext`)
- Modify: `src/workers/runner.ts`
- Test: `tests/workers/runner-control.test.ts`

**Interfaces:**
- Consumes: `DurableJobQueue`, `JobPausedError`, `JobCancelledError`, `isJobPausedError`, `isJobCancelledError`
- Produces: handlers receive:

```ts
export type JobHandlerContext = {
  jobId: string;
  payload: Record<string, unknown>;
  checkpoint: JobCheckpoint | null;
  setProgress(pct: number, message: string): void;
  saveCheckpoint(step: string, data?: unknown): Promise<void>;
  signal: AbortSignal;
  shouldPause(): boolean;
  throwIfPausedOrCancelled(): void;
};
```

- [ ] **Step 1: Write failing runner tests**

```ts
// tests/workers/runner-control.test.ts
it("marks paused when handler throws JobPausedError", async () => {
  // enqueue job; handler waits until pause requested then throwIfPausedOrCancelled
  // requestPause; expect status paused
});

it("marks cancelled when AbortSignal aborts", async () => {
  // handler awaits signal aborted promise; cancel(); expect cancelled
});

it("passes prior checkpoint into handler on resume", async () => {
  // saveCheckpoint before run; handler records ctx.checkpoint.step
});
```

Use `createInProcessJobQueue` + `createWorkerRunner` + `waitFor` from existing test helpers.

- [ ] **Step 2: Implement runner**

```ts
deps.queue.markRunning(job.id);
const controller = new AbortController();
deps.queue.attachAbortController(job.id, controller);
deps.queue.clearPauseRequest(job.id);

const throwIfPausedOrCancelled = () => {
  if (controller.signal.aborted) throw new JobCancelledError();
  if (deps.queue.isPauseRequested(job.id)) throw new JobPausedError();
};

try {
  await handler({
    jobId: job.id,
    payload: job.payload,
    checkpoint: job.checkpoint,
    setProgress: (pct, message) => deps.queue.setProgress(job.id, pct, message),
    saveCheckpoint: (step, data) => deps.queue.saveCheckpoint(job.id, step, data),
    signal: controller.signal,
    shouldPause: () => deps.queue.isPauseRequested(job.id),
    throwIfPausedOrCancelled,
  });
  deps.queue.markSucceeded(job.id);
} catch (error) {
  if (isJobPausedError(error)) {
    deps.queue.markPaused(job.id);
    // log paused
  } else if (isJobCancelledError(error) || controller.signal.aborted) {
    deps.queue.markCancelled(job.id);
  } else {
    deps.queue.markFailed(job.id, error);
  }
} finally {
  deps.queue.clearAbortController(job.id);
  deps.queue.clearPauseRequest(job.id);
}
```

Update `RunnerDeps.queue` type to `DurableJobQueue`.

- [ ] **Step 3: Fix compile of existing handlers** — temporarily ignore unused context fields; they still typecheck.

- [ ] **Step 4: Tests PASS + commit**

```bash
git commit -m "feat(jobs): wire pause and cancel into worker runner"
```

---

### Task 6: AbortSignal in FFmpeg + yt-dlp adapters

**Files:**
- Modify: `src/ports/render.ts` — `render(input, options?: { signal?: AbortSignal })`
- Modify: `src/ports/video-download.ts` — `download(id, options?: { signal?: AbortSignal })`
- Modify: `src/adapters/ffmpeg/ffmpeg-render.ts`
- Modify: `src/adapters/media/ytdlp-download.ts`
- Update existing adapter tests if signatures break

- [ ] **Step 1: Implement child kill on abort**

In both spawn helpers:

```ts
function bindAbort(signal: AbortSignal | undefined, child: ChildProcess): void {
  if (!signal) return;
  const onAbort = () => {
    child.kill("SIGTERM");
    // on Windows SIGTERM is supported by Node for kill; if needed follow with child.kill()
  };
  if (signal.aborted) {
    onAbort();
    return;
  }
  signal.addEventListener("abort", onAbort, { once: true });
  child.once("close", () => signal.removeEventListener("abort", onAbort));
}
```

On abort, reject with `JobCancelledError` (import from domain) or a plain Error that runner maps when `signal.aborted`.

- [ ] **Step 2: Unit test spawn abort** (optional short test with a long `ffmpeg -f lavfi -i ...` or mock) — at minimum update `tests/adapters/ffmpeg-render.test.ts` / ytdlp tests to pass without signal.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(jobs): honor AbortSignal in ffmpeg and yt-dlp adapters"
```

---

### Task 7: Handler step checkpoints

**Files:**
- Modify: `src/workers/handlers.ts`
- Modify: `src/workers/publish-short-handler.ts`
- Test: `tests/workers/handler-checkpoints.test.ts`

**Pattern for each multi-step handler:**

```ts
async function runStep(
  ctx: JobHandlerContext,
  jobType: string,
  step: string,
  fn: () => Promise<void>,
): Promise<void> {
  ctx.throwIfPausedOrCancelled();
  if (checkpointReached(ctx.checkpoint, step, jobType)) {
    return;
  }
  await fn();
  await ctx.saveCheckpoint(step);
  ctx.throwIfPausedOrCancelled();
}
```

Put `runStep` in `src/workers/run-step.ts` to keep handlers smaller.

**Per-handler requirements:**

| Handler | Steps |
|---------|--------|
| `download_source_video` | Skip download if `video.localMediaPath` exists OR checkpoint `download`; else `download(..., { signal: ctx.signal })`; `saveCheckpoint("download")` |
| `analyze_clips` / `analyze_replay` / `ideate` / `sync_channel` / `capture_replay` | single `run`/`capture` step wrapping existing body |
| `assemble_generate_preview` | If possible split TTS vs assemble inside use-case; if use-case is atomic, keep one `assemble` step for v1 **or** add optional split in `assembleGeneratePreview` — **prefer:** checkpoint only `assemble` if split is invasive; spec lists `tts`,`assemble` — if use-case cannot split without large refactor, implement two logical checkpoints by calling TTS then assemble separately only if already separable. Check `run-ideation.ts`; if atomic, use single step `assemble` and note deviation in commit message. |
| `render_short` | `prepare` (brand + render input + saveJob running); `render` (`deps.render.render(input, { signal })` + candidate ready); `enqueue_publish` (enqueue publish job). On pause after `render`, do not enqueue publish until resume. |
| `publish_short` | `prepare` (token + job row); `upload` (upload call — pass signal if upload port supports it; if not, check abort before/after) |

On `JobPausedError` / `JobCancelledError` in render/publish: **do not** mark candidate `failed`. Re-throw after cleanup of partial output if needed. Only true errors use existing fail paths.

```ts
} catch (error) {
  if (isJobPausedError(error) || isJobCancelledError(error)) {
    throw error;
  }
  // existing fail handling
}
```

- [ ] **Step 1: Test render_short skips completed prepare/render**

Mock deps; set `ctx.checkpoint = { step: "render" }`; expect enqueue_publish called and render not called.

- [ ] **Step 2: Implement + PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(jobs): add idempotent step checkpoints to handlers"
```

---

### Task 8: Boot recovery + candidate orphan repair

**Files:**
- Create: `src/application/recover-queue.ts`
- Modify: `src/lib/container.ts` (`startWorkers`)
- Test: `tests/application/recover-queue.test.ts`

**Interfaces:**

```ts
export function createRecoverQueue(deps: {
  queue: DurableJobQueue;
  candidates: CandidateRepository;
  logger: Logger;
}): () => Promise<{ requeuedRunning: number; repairedCandidates: number }> {
  return async () => {
    const { requeuedRunning } = await deps.queue.recoverOnBoot();
    let repairedCandidates = 0;
    const all = await deps.candidates.list(/* if list supports filter; else list all and filter */);
    for (const c of all) {
      if (c.status !== "rendering" && c.status !== "publishing") continue;
      const active = deps.queue.listJobs().some(
        (j) =>
          j.payload.candidateId === c.id &&
          (j.status === "queued" || j.status === "running" || j.status === "paused") &&
          ((c.status === "rendering" && j.type === "render_short") ||
            (c.status === "publishing" && j.type === "publish_short")),
      );
      if (active) continue;
      await deps.queue.enqueue({
        type: c.status === "rendering" ? "render_short" : "publish_short",
        payload: { candidateId: c.id },
      });
      repairedCandidates += 1;
      deps.logger.warn("Repaired orphan candidate with recovery job", {
        candidateId: c.id,
        status: c.status,
      });
    }
    return { requeuedRunning, repairedCandidates };
  };
}
```

Wire in `startWorkers` **before** `runner.start()`:

```ts
void (async () => {
  await recoverQueue();
  runner.start();
})();
```

Also switch container `jobQueue` to `createSqliteJobQueue({ db: ..., ... })` using the existing db connection from repositories. If `createContainer` currently does not expose `db`, either return it from repository factory or create queue with same `createDb(env.DATABASE_PATH)` singleton — **do not open a second conflicting connection**; reuse the db instance already used by repositories.

Inspect `createRepositories` / `createDb` usage in `container.ts` and pass `db` into `createSqliteJobQueue`.

- [ ] **Step 1: Tests for orphan repair**

- [ ] **Step 2: Implement + wire**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(jobs): recover queue and orphan candidates on boot"
```

---

### Task 9: Job control API routes

**Files:**
- Modify: `app/api/jobs/route.ts` — include `checkpointStep`, `position`
- Modify: `app/api/jobs/[id]/progress/route.ts` — return full `JobProgressView`
- Create: `app/api/jobs/[id]/pause/route.ts`
- Create: `app/api/jobs/[id]/resume/route.ts`
- Create: `app/api/jobs/[id]/cancel/route.ts`
- Create: `app/api/jobs/[id]/move/route.ts`
- Create: `app/api/jobs/reorder/route.ts`

**Handlers pattern:**

```ts
// pause/route.ts
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const result = await getContainer().jobQueue.requestPause(id);
  if (!result.ok && result.code === "not_found") {
    return NextResponse.json({ error: result.message }, { status: 404 });
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
```

```ts
// reorder/route.ts
export async function POST(req: Request) {
  const body = await req.json();
  const orderedIds = body.orderedIds;
  if (!Array.isArray(orderedIds) || !orderedIds.every((x) => typeof x === "string")) {
    return NextResponse.json({ error: "orderedIds must be string[]" }, { status: 400 });
  }
  try {
    await getContainer().jobQueue.reorder(orderedIds);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
```

```ts
// move/route.ts — body { to: "top" | "bottom" }
```

- [ ] **Step 1: Implement routes**

- [ ] **Step 2: Manual smoke or thin vitest hitting queue methods (routes optional to unit-test)**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(jobs): add pause, resume, cancel, reorder API routes"
```

---

### Task 10: Jobs UI — controls, reorder, polling

**Files:**
- Modify: `app/components/JobProgress.tsx`
- Modify: `app/jobs/page.tsx`
- Modify: `app/globals.css` (minimal controls styling consistent with existing chips/buttons — no new design system)

**Behavior:**
- Extend `JobView` with `checkpointStep: string | null`, `position: number`.
- Poll `GET /api/jobs` every 2s when any job is `queued`|`running`|`paused` (full list replace).
- Per row actions:
  - running: buttons Pause, Cancel
  - paused: Resume, Cancel, Top, Bottom
  - queued: Cancel, Top, Bottom
- Drag-and-drop: use HTML5 drag events among queued+paused rows; on drop, build new `orderedIds` and `POST /api/jobs/reorder`.
- Show subtitle like `paused @ render` when `checkpointStep` set.

Keep styling aligned with existing `job-card` / `chip` classes; add a compact `job-actions` row with text buttons (no purple/glow).

- [ ] **Step 1: Implement UI**

- [ ] **Step 2: Manual check in browser (`npm run dev` → `/jobs`)

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(jobs): add pause, reorder, and resume controls to Jobs UI"
```

---

### Task 11: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`  
Expected: all PASS

- [ ] **Step 2: Run production build**

Run: `npm run build`  
Expected: success

- [ ] **Step 3: Fix any regressions (type errors from JobHandlerContext, listJobs ordering, progress shape)**

- [ ] **Step 4: Commit any fixups**

```bash
git commit -m "fix(jobs): address queue control integration regressions"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Status `paused` | 1 |
| Soft pause between steps | 5, 7 |
| Hard cancel + child kill | 5, 6 |
| Explicit resume only | 3, 4 |
| Reorder + top/bottom | 3, 4, 9, 10 |
| SQLite `queue_jobs` | 4 |
| Checkpoints per job type | 1, 7 |
| Boot recover running→queued | 3, 4, 8 |
| Orphan candidate repair | 8 |
| API routes | 9 |
| Jobs UI | 10 |
| Logging context | throughout adapters/runner |
| Tests | 1, 3, 4, 5, 7, 8, 11 |

## Self-review notes

- No TBD placeholders left; assemble_generate_preview may use one step if TTS/assemble cannot split without large refactor — implementer must document that single deviation in the Task 7 commit body if taken.
- `DurableJobQueue` naming is consistent across tasks.
- `getProgress` gains `status` + `checkpointStep` — all callers must update (API + tests).
