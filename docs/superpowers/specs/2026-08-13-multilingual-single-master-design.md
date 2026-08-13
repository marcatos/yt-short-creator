# Multilingual single-master YouTube pipeline — Design Spec

**Date:** 2026-08-13  
**Brand:** S.Marcato 42 Racing  
**Status:** Implementation in progress (supersedes dual-upload default)

## 1. Purpose

Transform sim-racing replays into **interesting race stories** for YouTube with:

- Fase A: verified `RaceAnalysis` (never invent hard facts)
- Fase B: language-neutral master + IT/EN assets
- Assets-first publish; Studio checklist when multi-audio API is incomplete

## 2. Product decisions (locked)

| Decision | Choice |
|----------|--------|
| Publish model | **One master video → multi-language assets** |
| Duplicate IT/EN renders | Only when burned-in language is required (mostly Shorts Case B) |
| YouTube multi-audio | Assets on disk + Studio checklist when API cannot attach tracks |
| Localizations | API `videos.update` title/description when connected |
| Captions | Soft SRT IT/EN via Captions API |
| Hardware block | Static `config/hardware.json` — never LLM |

## 3. Supersedes

[`2026-08-12-bilingual-vo-captions-design.md`](./2026-08-12-bilingual-vo-captions-design.md) dual-upload lock for **full-race** delivery. Case B Shorts may still produce `short_it.mp4` / `short_en.mp4`.

## 4. Operator Studio checklist (typical)

1. Open the published video in YouTube Studio.
2. Attach secondary audio tracks from the session `delivery/` folder (`audio_it.m4a`, `audio_en.m4a`) if multi-audio is not API-complete.
3. Confirm IT/EN localized titles and descriptions.
4. Upload localized thumbnails when `thumbnail_it` / `thumbnail_en` (or SVG concepts) are ready.

## 5. Artifacts

See plan success criteria: `race_analysis.json`, `master_video.mp4`, `audio_it`/`audio_en`, subs, `youtube_metadata.json`, thumbnail concepts.
