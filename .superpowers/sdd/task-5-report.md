# Task 5 Report — FFmpeg VO duck and ASS burn-in

## Status

DONE_WITH_CONCERNS

## Delivered

- Extended `RenderInput` with ASS caption and voice-duck controls.
- FFmpeg clip and multi-segment renders now lower game audio using `10^(dB/20)`, mix VO with `amix`, and map the mixed output.
- Clip, replay, and generated renders burn ASS captions when enabled, including FFmpeg-safe Windows drive path escaping.
- `render_short` selects an optional `it`/`en` VO package, defaults to the first available package, and applies `shortsBurnInCaptions` and `voiceDuckDb` settings.
- Existing non-VO audio mapping remains unchanged when no VO package is available.
- Render logs expose VO/caption mode and language context while preserving existing timing and failure logs.

## TDD and verification

- Red: the adapter test failed because FFmpeg omitted the VO input; the generated-short test failed because its filter omitted ASS.
- Red: the handler test failed because VO/caption/settings fields were not forwarded.
- Focused green: 4 files, 6 tests passed.
- Full suite: `npm test` — **41 files, 141 tests passed**.
- Real FFmpeg smoke coverage passed for the existing non-VO 1080x1920 render.
- `npx tsc --noEmit` remains blocked by unrelated pre-existing FFmpeg proxy, YouTube SDK, settings-fixture, implicit-`any`, and legacy media-store fixture errors; no error references Task 5 files.

## Commit

- `b443b8c` — `feat(render): duck game audio under VO and burn-in ASS`

## Concerns

- Resolved in the follow-up below: VO packages now persist language-specific output paths.
- Resolved in the follow-up below: the edited worker test now uses normalized line endings.

## Important finding follow-up — bilingual output collision

- Added `MediaStorePort.voRenderPath(candidateId, language)` with distinct `renders/<candidateId>/vo-it.mp4` and `vo-en.mp4` filesystem paths; the canonical non-VO `renderPath` is unchanged.
- VO render outputs are persisted on the matching `VoiceOverPackage.renderOutputPath`; `ShortCandidate.renderOutputPath` remains reserved for non-VO publishing.
- VO completion and failure no longer move the candidate through the global ready/failed gate, and VO jobs do not enqueue the candidate-global publish job. This keeps the second language render eligible without implementing Task 6 publishing.
- No schema migration was required because `voice_overs` is already persisted as JSON.
- TDD red evidence: media-store test failed with `voRenderPath is not a function`; the dual handler test failed because the first VO render changed candidate status to `ready`.
- Focused verification: `tests/adapters/ffmpeg-vo-burnin.test.ts`, `tests/adapters/fs-media-store.test.ts`, and `tests/workers/render-handler.test.ts` — **3 files, 5 tests passed**.
- Full verification: `npm test` — **41 files, 141 tests passed**; `git diff --check` passed after normalizing the edited worker test line endings.
- `npx tsc --noEmit` remains blocked only by pre-existing FFmpeg proxy, YouTube SDK, settings-fixture, implicit-`any`, and legacy media-store fixture errors; the new bilingual render-path errors are resolved.
