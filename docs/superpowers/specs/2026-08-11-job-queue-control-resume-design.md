# Job queue: pause, cancel, reorder, durable resume

Date: 2026-08-11  
Status: approved for planning  
Related: in-process FIFO queue (`src/adapters/jobs/in-process-queue.ts`), worker runner, `/jobs` UI

## Problem

Jobs today live only in memory (single-worker FIFO). On app restart, queued/running work is lost while SQLite candidates can remain stuck in `rendering` / `publishing`. There is no pause, cancel, or reorder.

## Goals

1. **Pause (soft):** cooperative stop between handler steps; requires explicit Resume.
2. **Cancel (hard):** immediate abort via `AbortSignal`, including child processes (FFmpeg / yt-dlp) where adapters support it.
3. **Reorder:** drag-and-drop plus “move to top/bottom” for `queued` and `paused` jobs; `running` stays fixed.
4. **Durable resume:** persist the full queue in SQLite; on restart, continue from the last completed checkpoint step per job type.

## Non-goals

- Multi-worker / distributed queue (Redis, BullMQ)
- Priority levels beyond explicit order
- Dedicated retry UI (existing `retryFailedJob` use-case may be wired later)
- Mid-FFmpeg frame-level resume (render step restarts if interrupted)

## Decisions (from brainstorming)

| Topic | Choice |
|-------|--------|
| Interrupt model | Mixed: pause soft between steps; cancel hard |
| Restart resume | Intelligent checkpoints per job type |
| Reorder UX | Drag-and-drop + top/bottom |
| Pause resume | Explicit Resume only (`paused` never auto-claimed) |
| Architecture | Durable SQLite queue + AbortSignal + step checkpoints |

## Architecture

```
UI / API
  → JobQueuePort (enqueue, pause, resume, cancel, reorder, move, progress, checkpoint)
  → SqliteJobQueue adapter (queue_jobs table)
  → WorkerRunner (concurrency 1, AbortController per running job)
  → Handlers (idempotent steps + saveCheckpoint + throwIfPausedOrCancelled)
```

`render_jobs` / `publish_jobs` remain domain history for render/publish.  
**Source of truth for the worker queue is `queue_jobs`.**

## Data model

### Statuses

`queued` | `running` | `paused` | `succeeded` | `failed` | `cancelled`

### Table `queue_jobs`

| Column | Notes |
|--------|--------|
| `id` | Job id |
| `type` | Handler key |
| `payload` | JSON |
| `status` | See above |
| `position` | Integer; claim order ascending among claimable jobs |
| `progress_pct` | 0–100 |
| `progress_message` | Human-readable |
| `checkpoint` | JSON `{ step: string, data?: unknown }` — last **completed** step |
| `error` | Failure message when `failed` |
| `created_at`, `started_at`, `finished_at`, `updated_at` | Timestamps |

### Claim rules

- `claimNext` selects the lowest `position` with status `queued`.
- `paused` is never claimed until Resume sets status back to `queued`.
- Terminal statuses are excluded from claim and reorder.
- After a crash, `recoverOnBoot` sets orphan `running` jobs back to `queued` **without clearing checkpoint**, so the normal claim path resumes them. Their `position` is left unchanged (they stay ahead of later enqueues).

## Worker control

### Handler context

```ts
{
  jobId: string;
  payload: Record<string, unknown>;
  checkpoint: { step: string; data?: unknown } | null;
  setProgress(pct: number, message: string): void;
  saveCheckpoint(step: string, data?: unknown): Promise<void>;
  signal: AbortSignal;
  shouldPause(): boolean;
  throwIfPausedOrCancelled(): void; // boundary helper
}
```

### Pause

1. API sets a pause-requested flag on the active run (and/or persists intent).
2. Handler calls `throwIfPausedOrCancelled()` at step boundaries.
3. Runner catches pause outcome → status `paused`, checkpoint already saved for last completed step.
4. Job stays out of the worker until explicit Resume → `queued`.
5. On single-step jobs (`analyze_*`, `ideate`, etc.), pause takes effect only after the current `run` step finishes (cooperative). Cancel remains immediate via abort.

### Cancel

1. If `queued` or `paused` → status `cancelled` immediately.
2. If `running` → `AbortController.abort()`; adapters should terminate child processes; status `cancelled`.
3. Partial outputs for the incomplete step are discarded (not treated as checkpointed).

### Checkpoint steps (skip if already completed)

| Job type | Steps |
|----------|--------|
| `download_source_video` | `download` |
| `analyze_clips` | `run` |
| `analyze_replay` | `run` |
| `ideate` | `run` |
| `capture_replay` | `capture` |
| `assemble_generate_preview` | `tts`, `assemble` |
| `render_short` | `prepare`, `render`, `enqueue_publish` |
| `publish_short` | `prepare`, `upload` |
| `sync_channel` | `run` (stub) |

Atomic jobs (`analyze_*`, `ideate`) use a single `run` step: if cancelled mid-run they restart that step on resume/retry.

Handlers must be **idempotent per step** (e.g. if media already downloaded, `download` no-ops and checkpoints).

## Boot recovery

On `startWorkers()`:

1. **`recoverOnBoot()`**  
   - Jobs left `running` after crash → status `queued`, checkpoint preserved, `position` unchanged.  
   - Worker then claims them normally and handlers skip completed steps.
2. **Candidate orphan repair**  
   - Candidates in `rendering` / `publishing` with no active non-terminal `queue_jobs` row get a recovery job enqueued (log WARN).
3. Start the single worker loop.

## API

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/api/jobs` | List jobs (from SQLite), ordered for UI |
| `GET` | `/api/jobs/[id]/progress` | Progress + status (+ checkpoint step) |
| `POST` | `/api/jobs/[id]/pause` | `running` only; else 409 |
| `POST` | `/api/jobs/[id]/resume` | `paused` → `queued`; else 409 |
| `POST` | `/api/jobs/[id]/cancel` | Cancel queued/paused/running; terminal → no-op 200 |
| `POST` | `/api/jobs/reorder` | Body `{ orderedIds: string[] }` for `queued`+`paused` only; else 400 |
| `POST` | `/api/jobs/[id]/move` | Body `{ to: "top" \| "bottom" }` |

## UI (`/jobs`)

- Ordered list: active work first (`running`, then `queued`/`paused` by `position`); terminal jobs below or filterable.
- Controls:
  - `running`: Pause, Cancel
  - `paused`: Resume, Cancel, drag reorder, Top, Bottom
  - `queued`: Cancel, drag reorder, Top, Bottom
- Show checkpoint step on the row (e.g. `paused @ render`).
- Poll full job list (not only per-id progress) so reorder/resume/pause updates appear within ~2s; include `paused` in poll-worthy statuses.

## Port changes

Extend `JobQueuePort` beyond `enqueue` / `getProgress`:

- `listJobs`, `pause`, `resume`, `cancel`, `reorder`, `move`
- `saveCheckpoint`, `getCheckpoint` (or via job record)
- `recoverOnBoot`
- Internal: `claimNext`, `markRunning` / succeeded / failed / paused / cancelled, `setProgress`, pause-flag accessors for the runner

Replace (or wrap) `createInProcessJobQueue` with a SQLite-backed adapter. In-memory may remain for unit tests if desired, but production uses SQLite.

## Logging

Structured logs at INFO/DEBUG for: enqueue, claim, progress, checkpoint, pause request, paused, resume, cancel/abort, reorder, move, recoverOnBoot, orphan candidate repair, handler success/failure with durations and `jobId` / `type` / `step`. Never log secrets.

## Testing

1. SQLite queue: enqueue, claim order by `position`, pause/resume, cancel, reorder, move top/bottom.
2. Runner: respects `AbortSignal`; pause at boundary yields `paused` not `failed`.
3. Boot recovery: orphan `running` resumes from checkpoint (mocked handler).
4. Handler step skip: at least `render_short` and `download_source_video` skip completed checkpoint steps.
5. API: 409/400 cases for illegal pause/resume/reorder.

## Migration

- Add Drizzle schema + migration for `queue_jobs`.
- On first boot after upgrade, empty queue is fine; orphan candidate repair covers stuck pipeline states.

## Success criteria

- User can pause a running multi-step job; on Resume it continues after the last checkpointed step.
- User can cancel a running job and the external process stops (or is best-effort killed).
- User can reorder queued/paused jobs and change processing order before claim.
- Killing and restarting the app with jobs queued/running/paused restores the queue and continues work from checkpoints without manual re-enqueue (except explicit orphan repair for candidates).
