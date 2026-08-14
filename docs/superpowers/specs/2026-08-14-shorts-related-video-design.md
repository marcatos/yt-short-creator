# Shorts related video — Studio session after publish

**Date:** 2026-08-14  
**Status:** Approved product direction; pending implementation  
**Scope:** `publish_short` (clip + bilingual VO replay/generate). Not full-race publish.

## 1. Purpose

After a Short is uploaded, set YouTube Studio **Video correlato** (Related video): the clickable title under the channel handle. Goal is **channel growth** — convert a Short viewer into a long-form watch / subscribe — not to keep them in the Shorts swipe feed.

Official YouTube Data API v3 cannot set this field (`videos.update` ignores unknown related/linked ids). Studio Innertube `metadata_update` with OAuth Bearer is not sufficient (needs a signed-in Studio session / SAPISIDHASH). This feature uses a **persistent YouTube Studio browser session**.

## 2. Product contract (locked)

| Decision | Choice |
|----------|--------|
| When | After successful Short upload in `publish_short` |
| How | YouTube Studio session (browser profile), not Data API |
| What to link | Public long-form only (`durationSec > 60`) |
| Policy | Same-story public video, else channel hero (most views) |
| Failure | Best-effort: upload still succeeds if related video fails |
| Manual UI | **Backlog** — not in this implementation |

### Goals

- Every published Short that can be linked gets a related video that pushes the channel.
- Prefer the matching public race/source video over a generic “best of channel” link.
- Never send viewers to an unlisted master (e.g. session VO `QzinRQ6IVNo`) when a public cut of the same story exists (e.g. `_0H55Bo383k`).
- Never link Short → Short: the tap leaves the swipe feed; a 15–60s target wastes the conversion.

### Non-goals (this implementation)

- Setting related video via Data API or OAuth-only Innertube.
- Linking Short → Short.
- ML / engagement scoring beyond catalog `viewCount`.
- Re-processing the 2026-08-14 morning Shorts (already pointed at `_0H55Bo383k`).
- Changing clip description `Full video:` links (those stay).
- Operator UI to pick the related video (**backlog**, §8).

### Success criteria

1. After `publish_short` succeeds, Studio shows the chosen public long-form as related video (verified `linkedVideoId` after Salva).
2. Replay Shorts whose session full upload is unlisted still link a matching **public** long-form when one exists in the channel catalog.
3. If Studio session is missing, UI changed, or no eligible target exists, the job still completes; logs WARN with reason; no candidate `failed`.
4. Domain selection is unit-tested without a browser.

---

## 3. Selection policy (domain)

Pure function. Inputs: candidate, optional replay session, optional clip source, channel catalog videos (id, title, duration, privacy, publishedAt, viewCount). Output: `relatedVideoId | null`.

**Eligibility:** `privacy === "public"` AND `durationSec > 60` AND id ≠ the Short just uploaded. Missing or unknown privacy is not eligible.

**Order:**

1. **Clip origin** — source YouTube id if eligible; else fall through.
2. **Replay origin** — `session.fullVideoYoutubeId` if that id is eligible (public long-form). If missing or unlisted, pick the best **same-story** catalog match:
   - Session `trackName` is non-empty after trim; otherwise skip this match and fall through.
   - Title (case-insensitive) contains that `trackName`.
   - `publishedAt` within ±14 days of `session.fullVideoPublishedAt ?? session.createdAt`.
   - If several match: highest `viewCount`, then most recent.
3. **Hero fallback** (generate origin, or no match above) — eligible catalog video with highest `viewCount`; tie → most recent.
4. **None** — return `null` (skip Studio step).

Same candidate’s IT and EN VO uploads share the same related target.

Do not persist the choice on the candidate in v1 (always recompute at publish). Override persistence is backlog (§8).

---

## 4. Catalog gap

`source_videos` / `YouTubeCatalogPort` today lack `privacyStatus`. Unlisted masters would otherwise win or pollute the hero.

**This implementation:** extend catalog list + `source_videos` with `privacyStatus` (`public` | `unlisted` | `private`). `sync-channel` stores it from `videos.list` `status.privacyStatus`. Selection reads the local catalog (no extra YouTube call per Short beyond the sync the operator already runs).

If a video is missing from the catalog at publish time, treat it as ineligible rather than guessing.

---

## 5. Studio session (adapter)

Port: `YouTubeStudioRelatedVideoPort.setLinkedVideo({ shortYoutubeId, relatedVideoId })`.

Adapter: Playwright **persistent context** under `data/youtube-studio-profile/` (already gitignored via `data/`). Optional env `YOUTUBE_STUDIO_PROFILE_DIR`.

One-time login: headed script (e.g. `scripts/studio-login.ts`) that opens Studio and waits until the operator is signed in. Jobs reuse that profile headless (or headed if `YOUTUBE_STUDIO_HEADED=1` for debug).

Proven Studio UI (2026-08-14, Italian Studio):

- Page: `https://studio.youtube.com/video/{shortYoutubeId}/edit`
- Element: `ytcp-shorts-content-links-picker`
- Set: `picker.onLinkedVideoPicked({ detail: { videoId } })`
- Click **Salva**; wait until Salva is disabled and `picker.linkedVideoId` equals the target.

If the picker is absent (account without the feature) or save does not stick: throw a typed error the application layer catches.

**Lock:** serialize Studio calls (mutex). Worker concurrency is currently 1; the lock still protects headed login vs a job, and future concurrency.

**Missing profile / not signed in:** adapter fails fast with a clear error; application skips (WARN). Do not open an interactive login from a worker.

Do not log cookies, SAPISID, or profile paths that include secrets. Log short id, related id, durations, outcome.

---

## 6. `publish_short` wiring

After upload (and captions if any), if a related id was resolved:

1. Call `setLinkedVideo`.
2. Log INFO with ids and duration of the Studio step.
3. On failure: WARN + error message; **do not** fail the job or mark the candidate failed.

Wire both the clip path (`publish-short-handler`) and the VO path (`publish-vo-short-handler`). Resolve the target once per job (VO payload already has the candidate).

Skip when related id is null. Skip when the Short has no YouTube id (should not happen after upload).

---

## 7. Architecture

```text
domain/related-video.ts          pure selectRelatedVideo(...)
ports/youtube-studio-related-video.ts
adapters/youtube/studio-related-video.ts   Playwright persistent profile
application/attach-related-video.ts        resolve + call port, swallow errors
workers/publish-*-handler.ts               one step after captions
```

Dependencies point inward. Domain does not import Playwright, cookies, or Google APIs.

---

## 8. Backlog (do not implement now)

**Manual pick from recommendations.** On the candidate / publish review UI, show:

- The auto-selected related video (same policy as §3).
- Ranked alternatives: other same-story matches, then the hero, then other eligible public long-forms (cap the list).

The operator can confirm or pick another. Persist that override on the candidate. `publish_short` uses the override when present, otherwise auto-select.

This exists so growth policy stays overridable without re-running Studio by hand. Ship auto-attach first; add the UI when the picker has been used on a few real publishes.

---

## 9. Observability

- Job start already logged; add a related-video step: start, skip (reason), success (ids + ms), or warn (error + ms).
- End-of-job summary includes related: `set` | `skipped` | `failed`.
- Default log level INFO. No tokens, cookies, or full profile dumps.
