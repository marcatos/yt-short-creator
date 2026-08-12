# Task 6 Report — Dual Short publish and YouTube captions

## Status

DONE_WITH_CONCERNS

## Delivered

- Added a YouTube captions port and multipart `captions.insert` adapter with structured timing, success, and failure logs.
- Added `publishVoShortPair`, which validates complete IT/EN render and SRT artifacts and idempotently enqueues localized `publish_short` jobs.
- VO render completion now moves the candidate to `ready` only after both language artifacts exist, then enqueues both localized publishes.
- VO publishing uses each package's localized title, description, rendered video, and SRT; it persists video/caption IDs on the matching package.
- Video and caption upload use separate checkpoints, so a failed caption retry reuses the already-uploaded YouTube video.
- The candidate becomes `published` only after both IT and EN caption tracks complete.
- Confirmed OAuth already includes `https://www.googleapis.com/auth/youtube.force-ssl`.

## TDD and verification

- Red: pair and adapter tests failed on missing modules.
- Red: VO handler tests failed by entering the legacy single-publish-row path and requiring the candidate-global render.
- Red: render integration remained `rendering` and enqueued no localized jobs; caption checkpoint ordering was unknown.
- Focused green: 5 files, 13 tests passed.
- Full suite: `npx vitest run --exclude "**/node_modules/**" --exclude "**/dist/**"` — **44 files, 149 tests passed**.
- `npx tsc --noEmit --incremental false` remains blocked only by pre-existing FFmpeg proxy, YouTube SDK typing, settings-fixture, implicit-`any`, and legacy media-store fixture errors; no error references Task 6 files.
- Manual simplification and correctness review completed; dedicated multi-agent review was unavailable in this subagent scope.

## Commit

- `10d0d8f` — `feat(publish): dual IT/EN Short upload with SRT captions`

## Concerns

- The upstream workflow must enqueue both language-specific render jobs; Task 6 intentionally waits for both persisted render outputs before creating publish jobs.
- `git diff --check` reports CRLF as trailing whitespace on added lines in existing CRLF files; no actual spaces or tabs remain.

## Important finding remediation — external upload durability

- Immediately checkpoints the localized `youtubeVideoId` after YouTube video upload and both `youtubeVideoId`/`youtubeCaptionId` after caption upload, before candidate persistence can fail.
- Retry startup restores matching-language IDs from checkpoint data onto the `VoiceOverPackage`; completed checkpoint steps then skip the corresponding external upload.
- Added regressions for candidate-save failures after video upload and after caption upload; each retry performs exactly one video upload and one caption upload.
- Red evidence: the new tests observed only `{ step: "prepare" }` after video-save failure and `{ step: "upload" }` after caption-save failure.
- Focused verification: `npm test -- tests/workers/publish-vo-upload-checkpoint.test.ts tests/workers/publish-vo-handler.test.ts tests/workers/handler-checkpoints.test.ts` — **3 files, 15 tests passed**.
- Full verification: `npm test` — **45 files, 151 tests passed**.
- `git diff --check` passed.
- `npx tsc --noEmit --incremental false` remains blocked by the previously reported FFmpeg proxy, YouTube SDK, legacy settings-fixture, implicit-`any`, and media-store fixture errors; no error references the changed handler or new regression test.

## Important finding remediation — replacement-job durability

- Added per-candidate/per-language media sidecars (`vo-publish-{candidateId}-{language}.json`) and writes them immediately after successful video and caption inserts, before queue-row checkpoints and candidate persistence.
- Handler startup resolves upload IDs in priority order from the `VoiceOverPackage`, durable sidecar, then current-job checkpoint; replacement jobs therefore skip completed external uploads even when the failed job row is no longer reused.
- Candidate persistence and sidecar IO remain independently best effort: sidecar failures are logged without suppressing candidate persistence, while candidate-save failures leave the sidecar available to a new job.
- Boot orphan recovery now creates localized VO publish payloads from incomplete packages and never falls through to the invalid generic single-video publish path.
- Red evidence: the replacement-job test performed two video uploads, and recovery emitted only `{ candidateId }`.
- Focused verification: `npm test -- tests/adapters/fs-media-store.test.ts tests/workers/publish-vo-upload-checkpoint.test.ts tests/workers/publish-vo-handler.test.ts tests/workers/handler-checkpoints.test.ts tests/application/recover-queue.test.ts tests/lib/container-recovery.test.ts` — **6 files, 22 tests passed**.
- Full verification: `npm test` — **45 files, 153 tests passed**.
- `npx tsc --noEmit --incremental false` remains blocked only by the previously reported FFmpeg proxy, YouTube SDK, settings-fixture, implicit-`any`, and legacy media-store fixture errors; no error references files changed for this remediation.

## Important finding remediation — fail-closed publish durability

- Queue checkpoints now persist upload IDs, `scriptHash`, and the render basename before sidecar or candidate persistence is attempted.
- Sidecar and candidate writes are both attempted; sidecar failures are no longer swallowed, and combined persistence failures fail the handler after preserving the queue checkpoint.
- New jobs scan prior `publish_short` jobs of any status for the same candidate and language, then recover matching-script upload IDs to avoid duplicate YouTube inserts.
- Sidecar and prior-job recovery require the current package `scriptHash`; regenerated scripts ignore stale YouTube IDs.
- Red evidence: sidecar failures previously continued to candidate persistence, replacement jobs did not inspect the failed job checkpoint, and stale sidecars skipped both uploads.
- Covering verification: `npm test -- tests/workers/publish-vo-upload-checkpoint.test.ts tests/workers/publish-vo-handler.test.ts tests/workers/handler-checkpoints.test.ts` — **3 files, 18 tests passed**.
- Full verification: `npm test` — **45 files, 155 tests passed**.
- `npx tsc --noEmit --incremental false` remains blocked only by the previously reported FFmpeg proxy, YouTube SDK, settings-fixture, implicit-`any`, and legacy media-store fixture errors; no error references this remediation.
