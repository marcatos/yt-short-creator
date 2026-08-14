# Task final-fix report — Inspiration review (Important)

**Date:** 2026-08-14  
**Status:** Complete

## Findings fixed

### 1. Scheduler retry hammering

Scheduled enqueue used `getLatestOkSyncAt()` and applied in-memory throttle only when that was `null`. After one `ok` sync, a later `partial`/`failed` attempt left `latestOkSyncAt` old, so the 15-minute worker tick re-enqueued every interval.

**Fix:** `getLatestFinishedSyncAt()` (any status) is the durable last-attempt time. `enqueueScheduledInspirationSyncIfDue` combines that with in-memory `lastScheduledEnqueueAt` (secondary). Retries respect `INSPIRATION_SYNC_INTERVAL_HOURS`.

### 2. Replay slice before Inspiration bias

Replay sorted by score and sliced to `MAX_SHORTS` (16) *before* `applyInspirationToBatchIfConfigured`, so a low-score match never reached apply.

**Fix:** Sort the full ranked list, apply bias (fail-soft, no invented windows), then slice to 16 and persist the kept set. LLM/schema pool raised to 24 so apply can promote matches into the kept set. Clip path unchanged.

## Tests

```
npx vitest run tests/application/schedule-inspiration-sync.test.ts
npx vitest run tests/application/run-replay-analysis.test.ts
npx vitest run tests/adapters/inspiration-store.test.ts
npx tsc --noEmit
```

- Scheduler: 7/7 (includes failed follow-up within interval → no enqueue; 15m in-memory throttle)
- Replay: 6/6 (includes low-score Oschersleben match kept in 16)
- Store: 10/10 (`getLatestFinishedSyncAt` includes failed follow-up)
- Typecheck: pass

**RED (scheduler):** failed follow-up still enqueued (`expected true to be false`).  
**RED (replay):** after pool max 24, matched title missing from kept 16.  
**GREEN:** both suites pass.

## Commit

```
fix(inspiration): throttle scheduled retries and bias replay before slice
```

Unrelated WIP (layout density, rerender scripts, other sdd reports) left unstaged.
