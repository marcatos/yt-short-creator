# Task 7 report — Full-race VO generate + mix + dual upload

Status: **DONE_WITH_CONCERNS**

## Commits (d6fc88b..255681a)

| Commit | Scope |
| --- | --- |
| `63f9292` | `feat(replay): persist bilingual full-race voice-over packages` — `ReplaySession.fullVoiceOvers`, drizzle migration `0007_replay_full_voice_overs`, media-store paths (`fullReplayVoPath`, `fullReplayVoRenderPath`) |
| `b0c890d` | `feat(ffmpeg): concat VO chunks and mix narration onto full delivery encode` — `src/ports/full-vo-mix.ts`, `src/adapters/ffmpeg/ffmpeg-full-vo-mix.ts`, shared `ffmpeg-audio-filters.ts` |
| `f75e893` | `feat(vo): generate chaptered bilingual full-race voice-overs` — `src/application/generate-full-voice-overs.ts`, narration chunking + word offsetting in `src/domain/voice-over.ts` |
| `255681a` | `feat(replay): bilingual full-race VO mix and dual upload` — VO flag on the publish request, `src/workers/publish-full-replay-vo.ts`, handler branch, container wiring |

## What ships

- **Scripting.** One LLM call returns chaptered IT scripts plus an EN adaptation, per-language titles/descriptions, grounded in `racePackage.timeline` + transcript. Packages are cached by `scriptHash`, so a retry re-uses existing audio.
- **TTS chunking.** Narration is split at chapter boundaries, then at sentence boundaries, to a 700-word budget per call (spec: 500–800). Chunks are synthesized sequentially to `vo-{lang}-part-N.mp3` and concatenated with the FFmpeg concat demuxer; a single chunk skips the concat entirely.
- **Timing.** Whisper runs per chunk (avoids upload-size limits on 40-minute races); word timings are offset by the cumulative chunk duration, then written as soft SRT (`vo-{lang}.srt`). No ASS is generated for full races.
- **Mix.** `ffmpeg-full-vo-mix` ducks race audio (`voiceDuckDb`, default −12 dB), mixes the VO at unity, and **stream-copies the picture** so a full race mixes at audio speed. Burn-in (`fullBurnInCaptions`, default false) is the only path that re-encodes, reusing the delivery encoder args from `ffmpeg-full-video-encode`.
- **Dual upload.** `full-youtube-it.mp4` / `full-youtube-en.mp4` upload with `contentKind: "full"`, race-package tags, UI privacy (default unlisted), each followed by a soft SRT caption track. The IT upload becomes the session's canonical `fullVideoYoutubeId`, so the silent path can never publish the same race twice.
- **Durability.** Steps `voice_over`, `mix_{lang}`, `upload_{lang}`, `captions_{lang}` are registered in `QUEUE_JOB_STEPS`. Upload IDs are checkpointed before the DB write, and resume reads the session, the current checkpoint, and prior `publish_full_replay` job checkpoints, so a crash between upload and save never re-uploads.
- **Request dedup** now keys on the VO flag: a narrated request no longer collapses into an in-flight silent job (and vice versa).

## Tests

`npx vitest run` — **48 files, 186 tests, all passing.**

New coverage: `tests/application/generate-full-voice-overs.test.ts` (10), `tests/adapters/ffmpeg-full-vo-mix.test.ts` (6), `tests/workers/publish-full-replay-vo.test.ts` (7), plus additions to the voice-over domain, repositories, media-store, and request tests.

## Concerns

1. **No UI entry point yet.** `app/replays/page.tsx` still calls `requestFullReplayPublish` without `voiceOver`, so the narrated path is unreachable from the browser until the "Upload IT + EN with VO" control lands (design §6, plan step 5 / task 8). Backend, container, and worker wiring are complete and ready for that flag.
2. **`npx tsc --noEmit` reports 35 pre-existing error lines** in `ffmpeg-media-proxy.ts`, `youtube/upload.ts`, `stub-handlers.ts`, and several older test fakes with partial `AppSettings`/`MediaStorePort` literals. Verified against a stash of this task's changes: the baseline was 36 lines, and none of the remaining errors come from Task 7 files. Worth a cleanup task, since `next build` type-checks the whole project.
3. **Concat assumes uniform TTS output.** `-c copy` on the concat demuxer is correct for same-codec MP3 chunks from one provider; a provider that varies bitrate or sample rate between calls would need a re-encode fallback.
4. **Whisper cost scales with chunk count.** Per-chunk alignment is one API call per ~700 words, which for a long race is a handful of calls per language. Acceptable, but it is the dominant per-run cost after TTS.

---

# Review follow-up — Critical + Important findings

Status: **DONE**

## Commits (255681a..f7fffb6)

| Commit | Scope |
| --- | --- |
| `687652d` | `fix(vo): cap TTS chunks by characters and offset words from measured audio` — findings 1, 2, 4 and the dead `LANGUAGES` constant |
| `428cef8` | `fix(ffmpeg): release the full-race duck once the narration ends` — finding 5 |
| `f7fffb6` | `fix(replay): durably record full-race VO uploads and skip settled work` — findings 3, 6 |

## What changed

1. **Character-capped TTS chunks (Critical).** `chunkNarration(segments, limits)` now takes `TTS_CHUNK_LIMITS = { maxWords: 700, maxChars: 3500 }` and enforces both budgets at every level: chapter grouping, sentence splitting, and the word-by-word hard split. Italian narration averages well over 5 characters per word, so a 700-word chapter reached ~4.1k characters and was rejected by gpt-4o-mini-tts (4096 limit); the character cap is what actually fires now. `generate-full-voice-overs` logs `maxChunkChars` per language so an over-budget chunk would be visible before the provider rejects it.

2. **Offsets from real audio (Critical).** `synthesizeChunk` no longer reads `TtsSynthesizeResult.durationMs` at all. It probes the rendered chunk through the existing `MediaDurationPort` (ffprobe, wired in the container) and falls back to the last Whisper word `endMs` for that chunk when there is no probe or the probe fails — both cases log a warning. Those measured lengths are what accumulate into the combined `words` array and the SRT. The `openai-compatible-tts` estimate (`words × 400 ms`) is now unused by the full-race path; its drift compounded across every chunk of a 40-minute race.

3. **Durability sidecar (Important).** `createVoiceOverPublishSidecar` was generalized from `candidateId` to `ownerId` + an explicit `sidecarPath`, so both publish paths share it. New `MediaStorePort.fullVoPublishCheckpointPath(sessionId, language)` resolves to `media/replays/<session>/vo-publish-<lang>.json`; the full-race handler loads it into `resolveVoiceOverUploadCheckpoint` and writes it after both the upload and the captions step. Script-hash versioning comes free from the shared parser: a sidecar written for a different script is ignored. A replaced or purged job can no longer lose YouTube ids.

4. **No double-publish on re-run (Important).** `GenerateFullVoiceOvers` takes `regenerate?: boolean` (default `false`). A fresh LLM pass yields a new script hash on every run, so the old behaviour replaced published packages and dropped their `youtubeVideoId`, and the next upload step happily published the race again. Drifted-but-published languages are now kept as-is with a `warn`, and only `regenerate: true` rebuilds them. Combined with the sidecar and the existing package check, a re-run is a no-op for anything already on YouTube.

5. **Ducking gated to the narration (Important).** `duckedVoiceMixFilter` accepts `voiceDurationMs` and emits `volume='if(lt(t,END),DUCK,min(1,DUCK+(1-DUCK)*(t-END)/1))':eval=frame`, i.e. hold the duck for the narration, then ramp the race audio back to unity over one second. The handler derives `END` from the package's last word `endMs` — accurate now that offsets are measured. Omitting `voiceDurationMs` keeps the old constant duck, which is what the Shorts render path (`ffmpeg-render.ts`) still uses.

6. **Mix skipped for published languages (Important).** `mix_{lang}` returns early when the package carries a `youtubeVideoId` (including one just recovered from the sidecar or a prior job checkpoint), instead of re-encoding a 40-minute race for a video that is already online.

7. **Dead code (Minor).** The unused `LANGUAGES` constant in `generate-full-voice-overs.ts` is gone. The one in `publish-full-replay-vo.ts` drives the publish loop and stays.

## Tests

`npx vitest run` — **48 files, 199 tests, all passing** (was 186).

New/updated coverage:

- `tests/domain/voice-over.test.ts` (14): char-cap splitting for an Italian chapter that fits the word budget but busts 3500 chars, hard-split pieces staying inside the cap, and a rejected non-positive char budget.
- `tests/application/generate-full-voice-overs.test.ts` (11): the fake TTS now returns a deliberately absurd `999_999 ms` estimate the pipeline must ignore, and a fake ffprobe reports 30 s / 60 s per chunk — the asserted offsets (`0, 500, 30_000, 30_500`) and the SRT stamp `00:00:30,000` can only come from the probe. Two more cases assert the aligned-word fallback with no duration port and with a failing probe, and two cover the publish-safe regenerate semantics.
- `tests/adapters/ffmpeg-full-vo-mix.test.ts` (8): asserts the gated volume expression for a 754.2 s narration and the constant duck when the length is unknown.
- `tests/workers/publish-full-replay-vo.test.ts` (10): recovery from a media-store sidecar when the job checkpoint is gone (mix, upload, and captions all skipped for IT; the EN sidecar written), a stale-script-hash sidecar being ignored, and `voiceDurationMs` reaching the mixer only when the package has words.
- `tests/adapters/fs-media-store.test.ts`: the new sidecar path, including `..` traversal being stripped.

`npx tsc --noEmit` — **35 pre-existing error lines**, unchanged from the Task 7 baseline; none in files touched here.

## Remaining concerns

1. **Duck release is a fixed 1 s ramp** starting at the narration end. If a future script leaves long silent gaps mid-narration, the race stays ducked through them; true per-gap ducking would need `sidechaincompress` and a re-encode of the audio graph.
2. **The ffprobe fallback is silent-ish by design.** If ffprobe is missing in production, offsets quietly come from Whisper's last word, which is close but excludes trailing silence in the rendered MP3. The warning log is the only signal — worth an alert if chunk counts grow.
3. **`regenerate: true` has no caller yet.** The flag exists and is tested, but the UI control that would let an operator intentionally re-narrate a published race is still part of the Task 8 surface.

---

# Review follow-up — Regenerate-before-sidecar durability

Status: **DONE**

## What changed

- The full-race VO publisher now loads per-language sidecars and prior upload checkpoints before generation.
- A recoverable YouTube id restores its package with the sidecar's original `scriptHash`; generation therefore preserves that settled language and only builds unpublished languages.
- If both languages are already published, generation is skipped entirely.
- Sidecar parsing is shared between pre-generation recovery and the existing script-hash-validated post-generation checkpoint resolution.

## Regression coverage

`npx vitest run tests/workers/publish-full-replay-vo.test.ts` — **10 tests passing**.

The regression recreates a wiped DB package with only an IT sidecar (`scriptHash A` + YouTube id), then verifies IT is neither regenerated, mixed, nor uploaded while EN is generated and published.

---

# Review follow-up — Regenerate-before-sidecar ordering

Status: **DONE**

## What changed

- The full-race VO worker now loads durable sidecars and prior job upload checkpoints before the `voice_over` generation step.
- When the DB package is missing, a settled package is restored from the durable `scriptHash` and YouTube ids before generation. When the package still exists, recovery is accepted only when its hash matches.
- Generation preserves restored published languages and only builds missing, unpublished languages. If both languages are already published, generation is skipped entirely.
- The recovered language also skips the expensive mix and video upload; a missing caption id can still resume the caption step from the deterministic SRT path.

## Regression coverage

`tests/workers/publish-full-replay-vo.test.ts` now covers an IT upload sidecar with `scriptHash: "published-hash-A"` after `fullVoiceOvers` was wiped. The next job restores the IT YouTube id and hash before generation, regenerates only EN, and neither mixes nor re-uploads IT.

## Verification

- `npx vitest run tests/workers/publish-full-replay-vo.test.ts` — **10 tests passing**
- `npx vitest run` — **48 files, 199 tests passing**
- `npx tsc --noEmit` — unchanged pre-existing errors only; none in the files touched by this follow-up

