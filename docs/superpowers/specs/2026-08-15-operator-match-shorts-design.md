# Operator Match — video × Inspiration → Shorts

**Date:** 2026-08-15  
**Brand:** S.Marcato 42 Racing  
**Status:** Design approved (Approach A) — awaiting operator review of this file  
**Related:** [2026-08-14-youtube-inspiration-design.md](./2026-08-14-youtube-inspiration-design.md), [2026-08-15-short-control-ui-redesign.md](./2026-08-15-short-control-ui-redesign.md)

## 1. Purpose

Let the operator **select library videos** and **select Inspiration ideas**, see the **best pairs**, then run a job that **analyzes clips constrained to those ideas** and **generate-fills** shortfalls — producing engaging Short candidates aimed at channel views/interactions, still gated by human approval before upload.

## 2. Product contract (locked)

| Decision | Choice |
|----------|--------|
| Output | Match + Analyze (clip, idea-constrained) + Generate fill |
| Pairing | N×M ranking → top K pairs (default K=5) |
| Dedup | At most **one idea per video** in the default top-K (operator can uncheck pairs) |
| Ranking | Composite: align + Studio signal + long-form analytics + idea freshness (no embeddings in v1) |
| UI | New `/match` page under Pipeline nav |
| Publish | Unchanged — Approve on Candidates still required |
| Stale Inspiration | Warning on UI; Run still allowed (operator-selected ideas bypass stale gate for bias) |

### Goals

- Operator-controlled pairing instead of “all active ideas” automatic bias only.
- Prefer High-signal long-form × strong Studio Inspiration angles.
- Reuse existing clip analyze + ideation fill pipelines with idea subset.

### Non-goals (v1)

- Semantic embeddings / vector search.
- Auto-publish or skipping approval.
- Driving Studio Inspiration’s in-product UI.
- Multi-idea-per-video auto-run (operator can still select overlapping pairs only via future override; v1 ranking enforces ≤1 idea/video).

### Success criteria

1. `/match` lists selectable library videos and active Inspiration ideas.
2. Preview shows ranked pairs with composite score + component breakdown.
3. Run enqueues `match_propose_shorts` and Jobs shows progress per pair.
4. Clip candidates for each accepted pair are idea-constrained (prompt + `applyInspirationToBatch` idea subset).
5. Generate fill runs when clip yield is short; candidates land in `/candidates` as `proposed`.
6. Unit tests cover ranking and idea-subset apply without browser.

## 3. UI — `/match`

**Nav (Pipeline):** Home · Library · **Match** · Candidates · Jobs

1. **Video picker** — checkboxes; title, duration, views/likes when present.
2. **Inspiration picker** — checkboxes; title, short chips; global Fresh/Stale badge.
3. **Ranking preview** — top K table: video · idea · `pairScore` · align / studio / analytics / fresh. Row checkboxes to exclude before Run. Editable K (default 5).
4. **Actions** — **Run match** → `POST /api/match/run`; links to Jobs / Candidates.
5. Empty/error: need connected channel, ≥1 video, ≥1 idea.

Visual language: existing Short Control shell (carbon / ice / rosso).

## 4. Ranking score

For each pair `(sourceVideo, idea)`:

| Component | Source | Range | Default weight |
|-----------|--------|-------|----------------|
| **align** | Jaccard tokens: video title (+ description if stored) ↔ idea corpus (title+summary+suggestedTitles+outline) | 0–1 | 0.40 |
| **studio** | Richness of audienceInterest / channelAlignment / relatedInterest | 0–1 | 0.25 |
| **analytics** | Log-normalized views/likes/comments among **selected** videos | 0–1 | 0.25 |
| **fresh** | 1 if idea from latest successful sync and mirror not stale; else decay | 0–1 | 0.10 |

```
pairScore = 0.40·align + 0.25·studio + 0.25·analytics + 0.10·fresh
```

Sort all N×M pairs descending; greedily take pairs with **≤1 idea per video** until K accepted (or operator checkbox set).

Optional env knobs for weights later; v1 ships defaults above.

## 5. Job `match_propose_shorts`

**Payload:** `{ pairs: [{ sourceVideoId, ideaId }], channelId? }` (accepted pairs only).

**Per pair (in score order):**

1. Run clip analysis for `sourceVideoId` with Inspiration prompt = **that idea only**.
2. `applyInspirationToBatch` with `ideaIds: [ideaId]` (skip stale gate for operator selection).
3. Persist candidates + `candidate_inspiration_links`.
4. Checkpoint progress (pair index / K, candidates created).

**Generate fill (after all pairs):**

- If matched yield below target or many pairs produced zero usable windows:
  - Up to `generateFillMax` (default 3) idea-guided generate candidates from **selected ideas still under-represented**.
  - Same materialize path as ideation fill; idea set = operator selection.

**Fault tolerance:** one pair fails → WARN + continue; job `partial` if ≥1 success, `failed` if none.

## 6. Application / domain changes (sketch)

| Area | Change |
|------|--------|
| `src/domain/inspiration.ts` | `scoreVideoIdeaPair`, `rankVideoIdeaPairs`, studio/analytics/fresh helpers |
| `src/application/apply-inspiration-to-batch.ts` | Accept optional `ideaIds`; optional `bypassStaleGate` |
| `src/application/inspiration-prompt-block.ts` | Format subset of ideas |
| `src/application/run-clip-analysis.ts` | Optional `ideaIds` / constrained prompt |
| New `src/application/run-match-propose-shorts.ts` | Orchestrate pairs + fill |
| Workers / queue | Job type `match_propose_shorts` |
| API | `POST /api/match/run`; optional `POST /api/match/preview` for server-side ranking |
| UI | `app/match/page.tsx` + client pickers; `NavSidebar` Pipeline entry |

## 7. Observability

- Log start/end, pair counts, per-pair duration, candidates created, fill count, partial/fail.
- Never log secrets; truncate long idea text in DEBUG.

## 8. Testing

- Domain: pair score ordering, ≤1 idea/video greedy, weight math.
- Apply batch: idea subset + bypass stale.
- Application smoke: fake LLM/store for two pairs + fill shortfall.
- Light UI test: Match page renders pickers / Run disabled until selection.
