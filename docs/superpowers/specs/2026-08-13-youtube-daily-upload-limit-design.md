# YouTube daily upload limit — automatic defer & resume

**Date:** 2026-08-13  
**Status:** Approved direction (Approach A); pending implementation  
**Scope:** All YouTube uploads (`publish_short` VO pairs, `publish_full_replay`)

## Problem

YouTube enforces a **per-channel daily upload limit** (API reason `uploadLimitExceeded`: “The user has exceeded the number of videos they may upload.”). This is separate from Google Cloud API quota units.

Today, hitting that limit marks publish jobs (and often candidates) as **failed**. Sibling EN jobs then fail with “cannot publish in status failed”. Manual re-queue burns more attempts and still fails until the ~24h window resets.

## Goal

When the daily upload limit is hit:

1. **Do not** treat the work as permanently failed.
2. **Park** all pending YouTube uploads automatically.
3. **Resume automatically** as soon as uploads are allowed again — no user action.
4. Preserve already-successful partial work (e.g. IT uploaded, EN not yet).

## Non-goals

- Raising or bypassing YouTube’s channel limit.
- Replacing video files on already-uploaded YouTube IDs.
- Changing render / VO generation behavior.
- Multi-channel / multi-account upload routing.

## Approach (A) — Deferred jobs + circuit breaker

### 1. Typed error

YouTube upload adapter maps `uploadLimitExceeded` (and equivalent message) to a domain/application error, e.g. `YouTubeUploadLimitExceededError`, with optional `retryAfter` hint (default policy below).

### 2. Publish handlers

On that error during upload (short VO + full-race):

- Persist checkpoint so partial success is kept.
- Transition job to a **deferred** state (reuse `paused` with structured checkpoint/reason **or** add explicit `deferred` if queue status enum is extended — prefer minimal schema change: `paused` + checkpoint `{ reason: "youtube_daily_upload_limit", retryAfter: ISO }`).
- Candidate stays **`ready` or `publishing`**, never `failed` solely due to daily limit.
- Log at WARN with `retryAfter` and job/candidate ids.

### 3. Global upload circuit breaker

Process-local (worker) state:

- When limit is observed, set `uploadsBlockedUntil = now + backoff`.
- While blocked, `claimNext` / runner **skips** starting new `publish_short` / `publish_full_replay` jobs (they remain queued). Other job types continue.
- Progress message for deferred/skipped: e.g. `Waiting for YouTube daily upload limit (retry after …)`.

Backoff policy (initial):

| Attempt after first hit | Delay before next try |
| --- | --- |
| 1 | 1 hour |
| 2 | 2 hours |
| 3 | 4 hours |
| 4+ | 6 hours (cap), until success |

On any successful upload, clear the circuit breaker immediately.

### 4. Automatic resume

Worker idle / periodic tick (every ~5–15 minutes, and on boot recovery):

1. If `now >= uploadsBlockedUntil` (or breaker cleared), resume deferred publish jobs whose `retryAfter <= now` (FIFO / queue position).
2. Re-enqueue or `resume()` so they become claimable.
3. If upload succeeds → continue remaining queue.
4. If limit hits again → re-defer with next backoff step.

Full-race and Shorts share the same breaker (same channel).

### 5. VO IT/EN pairs

- If IT succeeds and EN hits the limit: IT YouTube id kept; EN job deferred; candidate remains publishable for EN.
- If IT hits the limit first: both stay deferred / queued; no `failed` cascade.
- Sidecar / checkpoint continues to skip already-uploaded languages.

### 6. UI (Jobs page)

Show deferred publish jobs distinctly:

- Status label: waiting for YouTube daily upload limit  
- Optional: retry-after timestamp from checkpoint  

No new user action required to resume.

### 7. Observability

- INFO: breaker armed / cleared, deferred count, resume attempts  
- WARN: limit exceeded with job id, candidate id, retryAfter  
- Do not log tokens or full credentials  

## Success criteria

- Hitting daily limit never leaves Shorts/full publish in a dead `failed` state solely for that reason.
- After the window opens, pending uploads complete without manual re-queue.
- Successful partial uploads are not re-uploaded.
- Non-publish jobs are unaffected while the breaker is active.

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| False positive “limit” errors | Match API `reason` when present; else message substring; other errors still fail normally |
| Jobs stuck forever if channel banned | Cap visible wait; after N days still deferred but UI shows age; optional manual cancel unchanged |
| Multiple worker processes | Breaker is per process; DB `retryAfter` on each job is source of truth for resume |

## Out of scope follow-ups

- Persisting breaker state in SQLite across worker restarts (nice-to-have; boot can scan deferred checkpoints).
- Studio multi-audio checklist automation.
