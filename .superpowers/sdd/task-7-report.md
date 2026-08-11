# Task 7 report: Handler step checkpoints

**Status:** Done

**Commit:** `10b89da` — `feat(jobs): add idempotent step checkpoints to handlers`

**Files:**
- New: `src/workers/run-step.ts`, `src/workers/job-handler-context.ts`, `src/workers/handler-utils.ts`, `src/workers/render-short-handler.ts`, `src/workers/stub-handlers.ts`, `tests/workers/handler-checkpoints.test.ts`
- Modified: `src/workers/handlers.ts` (555 → 231 lines), `src/workers/publish-short-handler.ts`

**What changed:**
- `runStep(ctx, jobType, step, fn)` skips completed steps via `checkpointReached`, else runs, saves checkpoint, re-checks pause/cancel.
- `download_source_video`: skips download if `localMediaPath` set or checkpoint `download`; passes `{ signal }`.
- `analyze_*`/`ideate`/`sync_channel`/`capture_replay`: single `run`/`capture` step.
- `assemble_generate_preview`: single `assemble` step (use-case is atomic in `run-ideation.ts` — TTS+assemble combined in one call; splitting needs an invasive rewrite). Deviates from design doc's `tts`,`assemble` pair — documented in commit body.
- `render_short` (extracted to its own file): `prepare`/`render`/`enqueue_publish`; render gets `{ signal }`; publish only enqueued once `render` checkpoint reached, so pause after render blocks the enqueue until resume.
- `publish_short`: `prepare`/`upload`; upload port has no signal support, so runStep's boundary check stands in.
- Both handlers rethrow `JobPausedError`/`JobCancelledError` before the fail path, so candidate/render/publish rows are never marked failed on pause/cancel.

**Tests:** `handler-checkpoints.test.ts` (5 new tests) — render_short skips prepare+render at checkpoint `render` and enqueues publish once; pause after prepare rethrows without marking candidate/job failed; download_source_video skips the download call when local media exists (still checkpoints) and skips entirely when checkpoint already `download`. Full suite: 30 files / 94 tests pass. `tsc --noEmit` clean.

**Concerns:** None blocking. Minor: `createStubHandlers` had no external callers before this change (dead code), left in place as `stub-handlers.ts`.

## Important review fixes

- `publish_short` now checkpoints `upload` and returns without uploading when the candidate is already published or its publish job already succeeded with a YouTube video ID.
- `render_short` now checks queued, running, paused, and succeeded queue records before enqueueing `publish_short`, while still checkpointing `enqueue_publish`.
- Added regression coverage for pausing exactly after the `render` checkpoint, resuming with one publish enqueue, suppressing duplicate publish jobs, and skipping upload for published candidates.
- Verification: required worker tests passed (2 files / 9 tests), full suite passed (30 files / 97 tests), and `tsc --noEmit` passed.
