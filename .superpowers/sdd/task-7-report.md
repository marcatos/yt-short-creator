# Task 7 report: Apply bias to clip / replay / ideate

**Status:** DONE_WITH_CONCERNS

## Commits

- `a31ed6f` `feat(inspiration): bias clip, replay, and ideate candidate batches`

Unrelated WIP (layout density, scripts, other sdd reports) was left unstaged.

## What landed

- `src/application/inspiration-prompt-block.ts` — maps store records → domain `InspirationIdea` (`outline` etc. `""` when null); formats the “Active YouTube Inspiration ideas” LLM block; `loadInspirationPromptBlock` for callers.
- `src/application/apply-inspiration-to-batch.ts` — load active ideas; empty → INFO `inspiration_no_active_ideas` no-op; stale → WARN `inspiration_stale`, skip boost/quota/links; fresh → match, boost, quota reorder, delete-then-save links. Callers persist candidates *before* links (FK).
- Clip / replay / ideate inject the prompt block before the proposal LLM (prompt still runs when stale). After candidates exist, they call apply. Generate fill is **only** in `run-ideation` on fresh shortfall (second LLM, `selectIdeasForGenerateFill`, cap `generateFillMax`).
- `src/lib/container.ts` passes `inspirationStore` + `parseInspirationConfig(process.env)` into the three factories.
- Port: `deleteLinksForCandidates` so re-apply does not PK-collide on `(candidate_id, idea_id)`.

## Tests

```
npx vitest run tests/application/apply-inspiration-to-batch.test.ts tests/application/run-clip-analysis.test.ts tests/application/run-ideation.test.ts tests/application/run-replay-analysis.test.ts
```

**16/16 passed** (4 files). Also: pipeline smoke 2/2; `sync-inspiration` 4/4.

- apply: empty no-op, fresh boost+links+reorder, stale no boost/links, shortfall WARN, re-apply replaces links
- clip/replay/ideate: empty fake store = existing behavior
- ideation: generate fill on quota shortfall (second LLM)

## Concerns

1. `run-replay-analysis.ts` was already well over 300 lines; inspiration wiring is small but the file stays large.
2. `run-ideation.ts` is now ~446 lines after fill/materialize helpers.
3. `tests/adapters/inspiration-store.test.ts` (including the new replace-links case) cannot run in this Vitest Node (better-sqlite3 ABI 141 vs 127). Application re-apply is covered with a memory store that throws on PK collision. Production daemon uses Node v25.5.0 where sqlite is OK.
4. Inspiration store/config are optional on the three factories so existing smoke tests keep working; the container always injects them.

Daemon was RUNNING; restarted; `http://127.0.0.1:3000` OK.

## Review fixes (Important)

### 1. Fail-soft inspiration I/O after candidates exist

- `generateInspirationFill` wraps `listActiveIdeas()` so store failures WARN (`Inspiration generate fill skipped; failed to list active ideas`) and return `[]` — they no longer throw into the ideate job.
- `applyInspirationToBatch` wraps link delete+save: persistence failures WARN (`Inspiration link persistence failed; continuing with biased candidates`) and still return the boosted/reordered candidates. Store reads were already fail-soft.

### 2. Generate origin includes hook text in matching

- Apply accepts optional `matchTextFor`.
- `run-ideation` passes `matchTextFor` built from brief hooks (`candidateId → hook`) so generate candidates match on title + description + hook, not only `hookReason` (which generate provenance lacks).

### 3. Partial syncs count as fresh

- Port + Drizzle store: `getLatestSuccessfulSyncAt()` (status `ok` | `partial`).
- Apply uses that for the stale gate. `getLatestOkSyncAt` stays ok-only for the scheduled sync interval.

## Fix test evidence

```
npx vitest run tests/application/apply-inspiration-to-batch.test.ts tests/application/run-clip-analysis.test.ts tests/application/run-ideation.test.ts tests/application/run-replay-analysis.test.ts
```

**21/21 passed** (4 files). Also `tests/application/sync-inspiration.test.ts` 4/4.

- apply: link-write failure still returns boosted candidates; `matchTextFor` hook match; recent partial sync is not stale
- ideate: generate hook participates in match; fill `listActiveIdeas` throw does not fail the job
