# Product overview

YT Short Creator is the local **Short Control** desk for **S.Marcato 42 Racing**: a Next.js app on `localhost` that proposes branded YouTube Shorts, waits for human approval, then renders and uploads.

It is a single-operator tool. There is no multi-user SaaS surface. Publish always requires Approve.

## Product contract

| Decision | Choice |
|----------|--------|
| Output | Full pipeline: analyze → propose → brand render → approve → upload |
| Sources | **Clip** from long-form, **generate** from briefs, **replay** from iRacing / OBS |
| Runtime | Local app + web UI on `localhost` |
| Publish gate | Human approval required; upload is automatic after Approve |
| Brand | Assets and tokens from sibling pack at `BRAND_ROOT` |

### Goals

- Grow viewers and followers via Shorts between long-form uploads
- Mine long-form for high-signal clips; generate when inventory is thin
- Turn iRacing sessions into highlight Shorts and full-race deliveries
- Never publish without explicit approval

### Out of scope

- Multi-user / multi-channel SaaS
- Auto-publish without approval
- Full NLE editor parity
- Cross-post to TikTok / Instagram

## Surfaces (routes)

| Route | Purpose |
|-------|---------|
| `/` | Home shell |
| `/connect` | YouTube OAuth channel connect |
| `/library` | Channel catalog, clip analysis, generate ideas |
| `/match` | Pair library videos × Inspiration ideas → ranked preview → analyze + generate fill |
| `/inspiration` | YouTube Studio Inspiration mirror — active ideas, sync history, Sync now |
| `/replays` | iRacing / OBS replay sessions, Director capture, full-race publish |
| `/candidates` | Candidate list (filter by status / origin) |
| `/candidates/[id]` | Review, revise, reject, approve; optional VO |
| `/jobs` | Live job queue — pause, resume, cancel, reorder |
| `/setup` | Hardware / desk description blocks (IT + EN) |
| `/settings` | Brand root, privacy, encoder, TTS, VO / caption flags |

## Candidate pipeline

Origins: `clip` | `generate` | `replay`.

Typical path after proposal:

```text
proposed → (revising) → approved → rendering → ready → publishing → published
```

Failures land in `failed` (retryable from the UI). Rejected candidates are retained for audit.

Approve enqueues render, then publish. Workers also handle analysis, ideation, replay capture, bilingual voice-over packaging, and YouTube daily-upload deferrals.

## Using Inspiration (operator)

Inspiration is a **bias**, not a separate pipeline. After ideas are mirrored locally:

1. Open **`/inspiration`** — confirm active ideas, last sync status, and the **Stale** badge (default: sync older than 7 days).
2. Sync when Studio’s feed changes: **Sync now** on that page, or wait for the scheduled job (`INSPIRATION_SYNC_INTERVAL_HOURS`, default `24`). One-time Studio login: `npm run studio:login`.
3. Run **clip**, **generate**, or **replay** as usual. While active ideas are fresh, proposals get:
   - a soft LLM prompt block (title / summary / suggested titles),
   - score boost for matched candidates,
   - an alignment quota (~40% of the kept batch when enough matchable material exists).
4. On **Candidates**, look for the Inspiration chip — it links the proposal to the mirrored idea(s).

If ideas are **stale**, only the prompt soft-hint remains (no boost/quota). Clip and replay never invent windows to fill quota; generate may add a few inspiration-guided briefs. Missing Studio profile does not fail those jobs.

Design details and env knobs: [2026-08-14 youtube-inspiration](superpowers/specs/2026-08-14-youtube-inspiration-design.md).

## Capability map

- **Inspiration sync** — Playwright scrape of Studio Inspiration tab (manual + scheduled); biases clip/generate/replay proposals via prompt, score boost, and alignment quota (see **Using Inspiration** above)
- **Clip path** — sync library → analyze long-form windows → score and propose candidates
- **Generate path** — ideation briefs → assemble / preview → same approval path
- **Replay path** — `.rpy` / media / telemetry → analyze → Director or auto capture → Short or full-race publish
- **Bilingual VO + captions** — IT/EN TTS, optional burn-in / duck; soft SRT and Studio checklist for full deliveries
- **Jobs control** — pause / resume / cancel / reorder; circuit-breaker style defer when YouTube daily limits hit
- **Brand render** — FFmpeg encode with brand pack (tokens, stacked logo, story template)

## Stack

| Layer | Choice |
|-------|--------|
| UI | Next.js 15 (App Router) + React 19 |
| Data | SQLite via better-sqlite3 + Drizzle ORM |
| Jobs | Detached worker process (never inside Next) |
| Media | FFmpeg (+ optional QSV / NVENC / AMF / MediaFoundation / libx264) |
| Download | yt-dlp |
| Publish | YouTube Data API v3 (OAuth) |
| AI | OpenAI-compatible LLM + TTS (+ optional Whisper) |
| Logging | Pino |
| Tests | Vitest |
| Runtime | Node 25 (see `.nvmrc`); Windows production daemon via PowerShell |

### Code layout (hexagonal)

```text
src/domain/        pure business rules
src/application/   use cases
src/ports/         interfaces
src/adapters/      DB, YouTube, brand FS, FFmpeg, LLM…
src/workers/       job handlers
app/               Next.js UI + route handlers
```

## Brand pack and forking

This repo ships opinionated for **S.Marcato 42 Racing** (voice, race-copy defaults, hardware blocks, visual language).

To run for another channel you must at least:

1. Point `BRAND_ROOT` at a brand pack with the expected layout (`brand-identity/`, tokens, stacked logo, story assets)
2. Replace race-copy / TTS persona defaults and hardware text
3. Supply your own Google OAuth client and LLM / TTS credentials

The brand pack is a sibling checkout by default (`../smarcato42-racing`). CI uses fixtures under `tests/fixtures/smarcato42-racing`.

## Operator docs

- [README](../README.md) — vanity landing + quick start + env + OAuth + acceptance
- [Production daemon](daemon.md) — detached web + workers on Windows

## Design specs (engineering)

| Spec | Topic |
|------|-------|
| [2026-08-11 yt-short-creator](superpowers/specs/2026-08-11-yt-short-creator-design.md) | Core product + domain model |
| [2026-08-11 job-queue-control-resume](superpowers/specs/2026-08-11-job-queue-control-resume-design.md) | Queue pause / resume / recover |
| [2026-08-12 bilingual-vo-captions](superpowers/specs/2026-08-12-bilingual-vo-captions-design.md) | IT/EN VO + captions |
| [2026-08-13 multilingual-single-master](superpowers/specs/2026-08-13-multilingual-single-master-design.md) | Single master + multilingual delivery assets |
| [2026-08-13 youtube-daily-upload-limit](superpowers/specs/2026-08-13-youtube-daily-upload-limit-design.md) | Daily upload defer / resume |
| [2026-08-14 shorts-related-video](superpowers/specs/2026-08-14-shorts-related-video-design.md) | Related-video linking |
| [2026-08-14 youtube-inspiration](superpowers/specs/2026-08-14-youtube-inspiration-design.md) | Studio Inspiration mirror + candidate bias |

Agent policies (commit/push `main`, daemon restart-if-running): [AGENTS.md](../AGENTS.md), [git.md](git.md).
