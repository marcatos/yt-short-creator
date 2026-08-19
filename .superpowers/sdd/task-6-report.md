# Task 6 Report: Scheduler

## Status

**Complete**

## Commits

- `feat(workers): schedule periodic Inspiration sync`

## Changes

| File | Action |
|------|--------|
| `src/application/schedule-inspiration-sync.ts` | Created — `shouldEnqueueInspirationSync`, `enqueueScheduledInspirationSyncIfDue` |
| `src/lib/env.ts` | Added `INSPIRATION_SYNC_INTERVAL_HOURS` (default 24) |
| `src/lib/container.ts` | Boot + 15m interval enqueue; mirrors deferred YouTube upload pattern |
| `tests/application/schedule-inspiration-sync.test.ts` | Unit tests for `shouldEnqueueInspirationSync` |

## Tests

```
✓ returns true when last ok sync was longer ago than the interval (25h / 24h)
✓ returns false when last ok sync was within the interval (1h / 24h)
✓ returns true when there has never been an ok sync
```

Run: `npm test -- tests/application/schedule-inspiration-sync.test.ts`

## Behavior

- On worker boot and every 15 minutes, checks `getLatestOkSyncAt()` against `INSPIRATION_SYNC_INTERVAL_HOURS`.
- Enqueues `sync_inspiration` with `source: "scheduled"` when due.
- Skips if an active `sync_inspiration` job exists (queued/running/paused).
- When never synced, in-memory `lastScheduledEnqueueAt` throttles to one enqueue per interval.

## Concerns

- Check interval (15m) is hard-coded; only the sync interval is configurable via env.
- In-memory throttle resets on worker restart (may re-enqueue sooner after restart if never synced).
- No `clearInterval` on shutdown (consistent with existing YouTube resume interval).
