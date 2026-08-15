# YouTube Studio Inspiration — local mirror + candidate bias

**Date:** 2026-08-14  
**Status:** Implemented with known live-selector risk  
**Scope:** Sync Inspiration ideas from YouTube Studio into local SQLite; dashboard; bias all Short candidate origins (clip / generate / replay) via prompt + score boost + quota.

## 1. Purpose

Keep a local mirror of the channel’s YouTube Studio **Inspiration** recommendations and use them both as an operator dashboard and as a strong signal when proposing Shorts.

Official YouTube Data API v3 / Analytics API do **not** expose Inspiration. Access is via a **persistent YouTube Studio browser session** (same approach as Shorts related-video).

### Product contract (locked)

| Decision | Choice |
|----------|--------|
| Source | Studio Playwright session (not Data API) |
| Sync | Manual (UI/CLI) + scheduled periodic job |
| Capture depth | Full: card fields + outline, suggested titles, thumbnail notes |
| Influence | Soft prompt + score boost + **quota** on aligned candidates |
| Origins | clip, generate, replay — same bias rules (semantics differ; see §4) |
| Sync failure | Best-effort: WARN; pipeline continues without fresh ideas |

### Goals

- Operator can see what Studio currently suggests and past sync history.
- Analyze / generate pipelines prefer Inspiration-aligned angles without inventing footage facts.
- Batches of proposed candidates meet an alignment quota when ideas are fresh.

### Non-goals (v1)

- Driving Inspiration’s in-product prompt UI.
- Downloading / reusing Studio AI thumbnails as publish assets.
- Google Takeout as the primary feed.
- Semantic embeddings for matching (token overlap only).
- Per-candidate quota overrides in UI.
- Innertube-first parsing as the only path (optional soft capture of XHR is fine).

### Success criteria

1. Manual and scheduled sync persist an active idea set when Studio UI is available and the profile is signed in; each idea stores at least title+summary, and detail fields when the UI exposes them (`partial` if some expands fail).
2. `/inspiration` shows active ideas, sync history, stale badge, and Sync now.
3. After analyze/generate with fresh active ideas, at least `ceil(batchSize * quotaRatio)` of the **kept** proposed candidates are Inspiration-matched when enough matchable material exists; otherwise WARN `inspiration_quota_shortfall` and continue.
4. Domain match / boost / quota are unit-tested without a browser.
5. Missing Studio profile does not fail clip/replay/generate jobs.

---

## 2. Storage

### `inspiration_sync_runs`

| Column | Notes |
|--------|--------|
| `id` | Primary key |
| `startedAt` / `finishedAt` | Timestamps |
| `status` | `ok` \| `partial` \| `failed` |
| `ideaCount` | Ideas successfully captured |
| `errorMessage` | Nullable; no secrets |
| `source` | `manual` \| `scheduled` |

### `inspiration_ideas`

| Column | Notes |
|--------|--------|
| `id` | Primary key |
| `syncRunId` | FK to sync run |
| `externalKey` | Stable key: Studio id if present, else hash of normalized title+summary |
| `title`, `summary` | Required text |
| `audienceInterest` | Text or structured string from UI |
| `channelAlignment` | Text or structured string from UI |
| `relatedInterest` | JSON (related videos / signals as scraped) |
| `outline` | Text |
| `suggestedTitles` | JSON string array |
| `thumbnailNotes` | Text (style / description notes; not binary assets) |
| `rawSnippet` | Optional truncated debug text |
| `capturedAt` | Timestamp |
| `active` | Boolean — current mirror set |

**Snapshot policy:** each successful/partial sync sets previous ideas `active=false`, inserts new rows `active=true`. History remains queryable for the dashboard.

**Candidate link (v1):** side table `candidate_inspiration_links (candidateId, ideaId, alignmentScore)` — avoids widening every provenance union type. Application writes links when bias is applied.

---

## 3. Studio sync

### Port

`YouTubeStudioInspirationPort.sync(): Promise<InspirationCaptureResult>`

Returns ideas + per-idea field completeness; may be `partial` if some cards fail to expand.

### Adapter

- Playwright **persistent context** under `data/youtube-studio-profile/` (env `YOUTUBE_STUDIO_PROFILE_DIR` optional).
- **Shared mutex** with related-video Studio adapter (serialize all Studio automation).
- Navigate: Studio → Content → Inspiration tab.
- For each idea card (click **Show More** / **Mostra altro** until stable, up to `INSPIRATION_SCRAPE_MAX`, default 80): open detail → extract full fields → close/back.
- Prefer DOM extraction; if network responses for Inspiration are observed, may also parse them as enrichment (not required for v1 success).
- Headed one-time login only via `scripts/studio-login.ts` (already planned for related-video). Workers never open interactive login.
- Missing / logged-out profile: typed fail-fast error for the sync job only.

### Triggers

| Trigger | Behavior |
|---------|----------|
| UI “Sync now” | Enqueue `sync_inspiration` with `source=manual` |
| Scheduler | Same job, `source=scheduled`, default every 24h (`INSPIRATION_SYNC_INTERVAL_HOURS`, default `24`) |
| CLI | Optional thin wrapper enqueueing the same job |

### Observability

Log: sync start (`source`), progress `idea i/n`, end with status, counts, duration ms. Never log cookies, SAPISID, or secret-bearing paths.

---

## 4. Influence (prompt + score + quota)

### Domain: `applyInspirationBias`

Pure functions in `domain/inspiration-match.ts` (names may vary):

1. **Match** — token overlap between candidate `title` + `description` + hook text (from provenance when present) and idea `title` + `summary` + `suggestedTitles` + `outline`.  
   - Config: `INSPIRATION_MATCH_MIN` (default `0.25`).  
   - Output: `matchedIdeaIds`, `alignmentScore ∈ [0,1]`.

2. **Score boost** — if matched: `score = min(1, score + INSPIRATION_SCORE_BOOST * alignmentScore)` (default boost `0.12`).

3. **Quota reorder / fill** — `INSPIRATION_QUOTA_RATIO` default `0.4`.  
   - Target aligned count = `ceil(keptBatchSize * quotaRatio)`.  
   - **Stale gate:** if latest successful sync is older than `INSPIRATION_STALE_DAYS` (default `7`), skip boost and quota; still allow prompt soft-hint; log WARN `inspiration_stale`.

| Origin | Quota semantics |
|--------|-----------------|
| `clip` / `replay` | Re-rank so matched candidates sit in the kept set preferentially. If too few matches: keep best available, WARN `inspiration_quota_shortfall`. **Never invent windows.** |
| `generate` | On shortfall, create additional inspiration-guided briefs/candidates up to `INSPIRATION_GENERATE_FILL_MAX` (default `3`) from strongest unmatched active ideas. |

### Prompt injection

When any active ideas exist (fresh or stale), LLM steps in `analyze_clips`, `analyze_replay`, and generate include a compact “Active YouTube Inspiration ideas” block (title, summary, suggested titles). Instruction: prefer aligned angles/titles; do not invent facts absent from footage / brief. Boost + quota remain gated by freshness (§4 stale gate).

### Failure modes

| Case | Behavior |
|------|----------|
| No active ideas / sync never ran | No bias; INFO once per batch |
| Stale ideas | Soft prompt only; WARN |
| Studio sync failed | Sync job `failed`; other jobs unaffected |
| Match none | No boost; possible quota shortfall WARN |

---

## 5. UI

### `/inspiration`

- Active idea cards (title, summary, interest/alignment chips, suggested titles).
- Expand: outline, relatedInterest, thumbnail notes.
- Sync run history (status, ideaCount, source, timestamps).
- **Sync now** button → enqueue job.
- Stale badge when last ok sync > `INSPIRATION_STALE_DAYS`.

### `/candidates`

- Chip/badge when candidate has inspiration links; link or tooltip to idea title(s).

---

## 6. Architecture

```text
domain/inspiration-match.ts
ports/youtube-studio-inspiration.ts
ports/inspiration-store.ts
adapters/youtube/studio-inspiration.ts    Playwright + shared Studio mutex
adapters/db/schema + repositories
application/sync-inspiration.ts
application/apply-inspiration-to-batch.ts
workers: sync_inspiration (+ interval scheduler)
app/inspiration/page.tsx
scripts/studio-login.ts                   shared with related-video (if not already)
```

Dependencies point inward: domain has no Playwright / cookies / Google clients.

Wire `apply-inspiration-to-batch` at the end of clip/replay/generate proposal paths (after windows/briefs exist, before or as candidates are saved — single place per origin).

---

## 7. Testing

- Unit: token match, boost caps at 1, quota reorder, shortfall WARN path, stale disables hard bias.
- Application: sync with fake Studio port (ok / partial / failed).
- UI smoke optional; no live Studio in CI.

---

## 8. Backlog

- Embedding / LLM judge for alignment.
- Operator override of matched ideas per candidate.
- Innertube-first extractor once endpoints are stable.
- Related-video + Inspiration shared “Studio health” status page.

---

## 9. Config summary

| Env / setting | Default | Role |
|---------------|---------|------|
| `YOUTUBE_STUDIO_PROFILE_DIR` | `data/youtube-studio-profile` | Shared profile |
| `YOUTUBE_STUDIO_HEADED` | unset/0 | Debug headed Studio |
| `INSPIRATION_SYNC_INTERVAL_HOURS` | `24` | Scheduler |
| `INSPIRATION_MATCH_MIN` | `0.25` | Match threshold |
| `INSPIRATION_SCORE_BOOST` | `0.12` | Max additive scale factor |
| `INSPIRATION_QUOTA_RATIO` | `0.4` | Aligned fraction of batch |
| `INSPIRATION_STALE_DAYS` | `7` | Soft-only after this age |
| `INSPIRATION_GENERATE_FILL_MAX` | `3` | Extra generate fills |
| `INSPIRATION_SCRAPE_MAX` | `80` | Max cards to scroll-load + capture per sync |
