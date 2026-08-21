# Instagram Reels cross-post — design spec

**Date:** 2026-08-19  
**Plane:** YTSC-4  
**Status:** WIP parked on `main` (2026-08-21) — resume from Plane YTSC-4

## Resume checklist

1. Set env: `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI` (see `.env.example`).
2. Apply DB migration `0011_instagram_reels` if not already (`npm run db:migrate`).
3. Connect Instagram Business/Creator at `/connect`; configure Reel hashtags on `/settings`.
4. Verify Approve → `publish_reel` enqueues beside YouTube; check worker logs + `instagram_publish_jobs`.
5. Remaining polish (if any): live Meta OAuth smoke, permalink/caption QA, daemon restart after pull.

## Summary

Automatic Instagram Reels publishing via Meta Graph API, parallel to YouTube on the same Approve. Italian-only Reels when Instagram is connected. Independent job/status from YouTube.

## Operator setup

1. Instagram Business/Creator linked to a Facebook Page.
2. Meta Developer app with Facebook Login and permissions: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`.
3. Env: `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI` (default `http://localhost:3000/api/auth/instagram/callback`).
4. Connect at `/connect`. Configure Reel hashtags and optional YouTube URL override at `/settings`.

## Pipeline

- `render_short` completes (IT render for bilingual VO) → enqueue `publish_reel` + YouTube publish jobs.
- `publish_reel` steps: prepare → upload (resumable) → poll → publish.
- Failures stored on `instagram_publish_jobs`; candidate YouTube status unaffected.

## Caption strategy

Parallel publish → caption links to **YouTube channel**, not the specific Short URL. CTA block + simracing hashtags (no `#Shorts`).

## Data model

- `instagram_accounts` — connected IG account metadata.
- `instagram_publish_jobs` — one row per candidate (media id, permalink, caption, error).
- Migration: `drizzle/0011_instagram_reels.sql` (journal idx 11; `0010` is replay commentary).
