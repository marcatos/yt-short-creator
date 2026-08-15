# Short Control UI Redesign — Cleanuparr-inspired

**Date:** 2026-08-15  
**Brand:** S.Marcato 42 Racing  
**Status:** Approved (Approach A)  
**Supersedes (UI chrome only):** visual/IA gaps in [2026-08-11-yt-short-creator-design.md](./2026-08-11-yt-short-creator-design.md) §5 — brand tokens remain authoritative.

## 1. Purpose

Make the local Short Control desk as functional and pleasant as Cleanuparr’s ops UI, while keeping S.Marcato racing identity (carbon / ice / rosso / −18°).

## 2. Borrow vs reject

| Borrow from Cleanuparr | Reject |
|------------------------|--------|
| Sidebar + toolbar shell | Glassmorphism |
| PageHeader pattern | Purple sidebar / theme orbs |
| Dense ops rows / tables | Glow effects |
| Sticky filter chrome | External UI kits (PrimeNG, Tailwind, etc.) |
| Sectioned settings | SignalR charts / full design-system port |
| Home stats pulse | |

## 3. Brand constraints (locked)

- Surfaces: Carbon `#08080A`, Carbon Mid `#121216`
- Type: Ice `#F8F8FA`, Ice Dim `#C8C8D0`, Silver `#A8A8B0`
- Accent: Rosso Corsa `#E10600`
- Motifs: −18° parallelogram slash, hairlines
- Body font: Segoe UI / system sans
- Density: Normale / Compatto (`data-layout`)

## 4. Shell & navigation

- Fixed left sidebar (collapsible), darker carbon than main, hairline edge, brand lockup + slash at top.
- Main column: sticky toolbar (page context + density toggle) + scrollable content.
- Mobile: drawer sidebar + backdrop; no horizontal-scrolling top nav.
- Nav groups:
  - **Pipeline:** Home · Library · Candidates · Jobs
  - **Capture:** Replays · Inspiration
  - **Desk:** Setup · Settings · Connect
- Active route: left rosso accent or carbon-mid fill.

## 5. Home / dashboard pulse

1. Brand hero (SHORT CONTROL) + channel status + one primary CTA (Review queue / Connect / Library).
2. Pulse strip below hero: review count, active jobs, library/sync, inspiration stale — flat carbon-mid panels, not cards cluttering the hero.
3. Soft −18° stripe motion on empty/home brand panel only.

## 6. Ops lists

Shared pattern: PageHeader → sticky filter toolbar → dense rows → unified empty-panel.

- Candidates / Jobs: tighten chrome; keep triage/progress behavior.
- Library: compact catalog rows with clear per-row actions.
- Inspiration: denser list/board; sticky history table.
- Replays: shared CSS classes; sectioned forms; no ad-hoc inline styles.
- Review detail: chrome only; keep 9:16 preview + Approve (rosso).

## 7. Settings / Setup / Connect

- Long forms split into `settings-section` blocks (title + help + fields).
- Connect uses the same page shell as the rest of the desk.
- No full i18n pass; only align chrome labels we touch.

## 8. Non-goals

- Pipeline/API behavior changes
- Audiowide webfont unless already licensed in brand pack
- Porting Cleanuparr Angular/SCSS component kit
