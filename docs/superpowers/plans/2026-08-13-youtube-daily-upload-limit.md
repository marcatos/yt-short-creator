# YouTube Daily Upload Limit — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Automatically defer YouTube publish jobs on daily upload limit and resume them when uploads are allowed again.

**Architecture:** Typed `YouTubeUploadLimitExceededError` from the upload adapter; publish handlers pause (defer) instead of failing; a process-local circuit breaker parks sibling publish jobs; worker periodically resumes deferred jobs after `retryAfter`.

**Tech Stack:** TypeScript, existing SqliteJobQueue (`paused` + checkpoint), Vitest, Next.js Jobs UI.

## Global Constraints

- Prefer `paused` + checkpoint over new job status enum values.
- Candidate must not become `failed` solely due to daily upload limit.
- Short VO IT/EN and full-race publish share one breaker.
- Conventional commits; keep files focused (hexagonal boundaries).

---

### Task 1: Domain error + parse helper

**Files:**
- Create: `src/domain/youtube-upload-limit.ts`
- Test: `tests/domain/youtube-upload-limit.test.ts`

- [ ] Detect `uploadLimitExceeded` reason and message
- [ ] Backoff helper: attempt → delay (1h, 2h, 4h, then 6h cap)
- [ ] Commit `feat(domain): YouTube daily upload limit error`

### Task 2: Circuit breaker

**Files:**
- Create: `src/application/youtube-upload-circuit-breaker.ts`
- Test: `tests/application/youtube-upload-circuit-breaker.test.ts`

- [ ] `recordLimitHit(attempt)`, `recordSuccess()`, `isBlocked()`, `blockedUntil()`
- [ ] Commit `feat(upload): circuit breaker for YouTube daily limit`

### Task 3: Adapter maps API errors

**Files:**
- Modify: `src/adapters/youtube/upload.ts`
- Test: extend or add upload error mapping test if present

- [ ] On Google error with uploadLimitExceeded, throw domain error
- [ ] Commit `fix(youtube): map uploadLimitExceeded to typed error`

### Task 4: Defer helpers + publish handlers

**Files:**
- Create: `src/application/defer-youtube-upload.ts` (checkpoint shape + pause job + park queued publishes)
- Modify: `src/workers/publish-vo-short-handler.ts`
- Modify: `src/workers/publish-short-handler.ts` (if non-VO path uploads)
- Modify: `src/workers/publish-full-replay-handler.ts` / vo path
- Test: `tests/application/defer-youtube-upload.test.ts` + handler tests as needed

- [ ] On limit error: save checkpoint, throw `JobPausedError`, do not `publish_failed`
- [ ] Park other queued publish jobs with same retryAfter
- [ ] Commit `feat(publish): defer uploads when YouTube daily limit hits`

### Task 5: Worker resume loop

**Files:**
- Modify: `src/workers/runner.ts` or `src/lib/container.ts` `startWorkers`
- Create: `src/application/resume-deferred-youtube-uploads.ts`
- Test: `tests/application/resume-deferred-youtube-uploads.test.ts`

- [ ] Every 5 minutes + on boot: resume paused jobs with expired retryAfter
- [ ] Clear breaker on successful publish (handlers call `recordSuccess`)
- [ ] Commit `feat(workers): auto-resume deferred YouTube uploads`

### Task 6: Jobs UI label

**Files:**
- Modify: `app/components/JobProgress.tsx` (and/or jobs list mapping)

- [ ] Show waiting-for-quota when checkpoint reason matches
- [ ] Commit `feat(ui): show YouTube daily quota wait on jobs`

### Task 7: Re-queue current ready shorts (optional ops)

- [ ] After deploy/restart workers, enqueue reupload for the five ready Oschersleben shorts so they sit deferred until quota opens
