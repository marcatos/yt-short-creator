# Task 5 Report: Sync application + worker job

**Status:** DONE_WITH_CONCERNS
**Commit:** `b108d56` — feat(inspiration): sync job and manual enqueue API

## What was implemented

`createSyncInspiration(deps).run({ source })` orchestrates: persist run row → `studio.sync()` → map captured ideas to store records with **fresh `id.generate()` UUIDs** → `replaceActiveIdeas` → finish run `ok` / `partial` / `failed`.

- Failed Studio capture (or any throw) finishes the run as `failed` with `errorMessage`, does **not** replace the active set, then rethrows so the worker job fails.
- Worker `sync_inspiration` is a single `run` step (payload `{ source: "manual" | "scheduled" }`).
- `POST /api/inspiration/sync` enqueues `{ source: "manual" }` and returns `{ jobId }` with HTTP 202.
- Container wires `createYouTubeStudioInspirationAdapter` + store + `UuidIdPort` into the use case and handler deps.

## TDD Evidence

**RED** — test file existed; use case module did not:

```
npx vitest run tests/application/sync-inspiration.test.ts
FAIL  tests/application/sync-inspiration.test.ts
Error: Cannot find module '@/src/application/sync-inspiration'
```

Expected: feature missing, not a bad assertion.

**GREEN** — after implementing the use case (then handler / queue / container / API):

```
npx vitest run tests/application/sync-inspiration.test.ts
✓ tests/application/sync-inspiration.test.ts (4 tests)

npm test   (Node 25.5.0)
✓ 317/317 passed (78 files)
npx tsc --noEmit → OK
```

## Tests

| Case | Assertion |
|------|-----------|
| Fake Studio returns 2 ideas | Active list length 2; previous snapshot `active=false` |
| Second sync, same `externalKey` | New idea ids (no PK collision) |
| `partial` capture | Run status `partial`; ideas still replaced |
| Studio throws | Previous ideas stay active; run `failed`; error rethrown |

## Files

| File | Role |
|------|------|
| `src/application/sync-inspiration.ts` | Use case |
| `tests/application/sync-inspiration.test.ts` | Fake Studio + in-memory store |
| `src/domain/queue-control.ts` | `sync_inspiration: ["run"]` |
| `src/workers/handlers.ts` | Job handler |
| `src/workers/stub-handlers.ts` | Required `HandlerDeps` stub |
| `src/lib/container.ts` | Port + use case + handler wiring |
| `app/api/inspiration/sync/route.ts` | Manual enqueue |

Unrelated WIP (layout density, rerender scripts) was left unstaged.

## Self-review

- Mapping copies nullable scrape fields through as-is (`null` OK).
- Idea primary keys are never `externalKey`; production uses `UuidIdPort`.
- Logs: start (`runId`, `source`), capture step + duration, completed/failed + total duration. No cookies / profile paths.
- Daemon was RUNNING; restarted after commit. `http://127.0.0.1:3000` OK; `/api/inspiration/sync` in the production build.

## Concerns

- In-progress runs are saved with `status: "failed"` and `finishedAt: null` because the store type has no `running` status. This keeps `getLatestOkSyncAt()` from treating a crash as success. A hung sync could briefly look like a failure on the future dashboard.
- `HandlerDeps.syncInspiration` is required; several existing `createHandlers({...})` test sites omit it (tests are excluded from `tsc`). Runtime is fine until `sync_inspiration` is invoked. `stub-handlers.ts` is wired.
- `handlers.ts` is ~325 lines (plan preferred ≤300). `container.ts` was already well over that; this task only added wiring.
