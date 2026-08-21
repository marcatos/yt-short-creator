# Replay commentary audio + spoken markers

**Date:** 2026-08-21  
**Plane:** YTSC-11  
**Status:** implemented

## Problem

FASE A Whisper runs only on muxed OBS audio (usually engine/game noise). The operator already records a separate spoken commentary with intentional cues (“inizia la gara”, “giro 3”) that would give verified timing and narrative context for analysis and Short generation. Today there is no first-class commentary path — only CLI `operatorNotes` (untimed free text).

## Decision

Optional sidecar commentary audio on `ReplaySession`, transcribed instead of muxed audio when present, with hybrid spoken-marker extraction.

### Ingest

- Fields: `commentaryPath: string | null`, `commentaryOffsetMs: number` (default 0).
- Use case `attachReplayCommentary({ sessionId, commentaryPath, offsetMs? })` — local path attach (same pattern as media/IBT).
- UI `/replays` + CLI `--commentary` / `--commentary-offset-ms`.
- Formats: whatever ffmpeg/Whisper already accept (wav/mp3/m4a/flac).

### Audio source (v1)

- `resolveAnalysisAudio(session, proxy)` → `{ kind: "commentary" | "muxed", path, offsetMs }`.
- Commentary present → Whisper **only** on commentary (fail hard if Whisper fails; no silent muxed fallback).
- No commentary → muxed `proxy.audioPath` as today.
- Typed seam leaves room for future `kind: "both"` without rewriting callers.

### Transcript + markers

- Persist on `RaceAnalysis`: `audioSource`, `audioTranscript`, `audioTranscriptSegments[]`, `commentaryMarkers[]`.
- Apply `commentaryOffsetMs` so commentary clock maps to video clock; drop markers outside `[0, durationMs]`.
- **Hybrid markers:**
  - Domain heuristics for known IT/EN phrases → `race_start`, `lap` (+ `lapNumber`), `race_end`.
  - Unmatched segments may yield LLM-proposed markers; heuristic wins on conflict.
- Markers are verified facts (same authority tier as HUD / operator notes).
- Full timed transcript remains narrative context in the editorial prompt.

### Analysis uses

- `race_start` → demote/pre-gate pre-green Shorts (complements existing `raceEndMs`).
- `lap` markers → soft score boost near window (like HUD battles).
- Prompt block lists verified markers with timestamps.

## Out of scope (v1)

- Marker review/edit UI
- Dual Whisper (`both`)
- Mux commentary into published YouTube audio
- Auto sync / clap detection
- JSON/CSV sidecar markers

## Success criteria

- No commentary → identical Whisper path as today.
- With commentary + offset → offset-corrected transcript + structured markers in analysis; shorts can anchor on race start / lap cues.
