# Race-end gate for FASE A analysis

**Date:** 2026-08-21  
**Plane:** YTSC-10  
**Status:** implemented

## Problem

OBS race captures often continue after the checkered flag (cool-down, pit-in). FASE A treated that footage as racing: finish position came from the last HUD reading, battle windows included post-flag gaps, and narrative/Shorts could claim a failed overtake or “position not gained” while cars were only slowing to the pits.

## Decision

Deterministic HUD gate + prompt rules (no IBT session-state parsing in this pass).

1. `detectRaceEndMs(timeline)` — first snapshot whose `session.status` / `session.flag` matches post-race tokens (`checkered`, `cool down`, `finished`, …).
2. `inferResultsFromHud(..., { raceEndMs })` — only positions with `timeMs < raceEndMs`; when gated HUD finish exists, **override** LLM finish / `positionsGained`.
3. `detectBattleWindows` / `detectCalloutWindows` ignore snapshots at/after `raceEndMs`.
4. Filter racing event kinds (`overtake`, `battle`, `defense`, `pace_change`) with `startMs >= raceEndMs`.
5. Soft Short demotion via `demoteScoreAfterRaceEnd` when the window is mostly post-race.
6. FASE A / vision / HUD-extractor prompts state post-race rules explicitly when `raceEndMs` is known.

## Out of scope

- IBT/SDK session flags as source of truth (future).
- Auto re-analysis of already published races.
- New DB migrations / new event kind `finish` (optional later).
