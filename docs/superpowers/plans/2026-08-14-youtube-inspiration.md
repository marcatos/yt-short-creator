# YouTube Studio Inspiration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror YouTube Studio Inspiration ideas locally (manual + scheduled sync), show them in `/inspiration`, and bias clip/generate/replay candidate batches with prompt hints, score boost, and alignment quota.

**Architecture:** Playwright persistent Studio profile scrapes Inspiration (DOM-first); SQLite stores sync runs + ideas + candidate links; pure domain match/boost/quota; application wires bias after proposal in analyze/ideate paths; worker job `sync_inspiration` + interval scheduler.

**Tech Stack:** Next.js 15, TypeScript, Drizzle/SQLite, Playwright, Vitest, existing job queue + hexagonal ports.

**Spec:** `docs/superpowers/specs/2026-08-14-youtube-inspiration-design.md`

## Global Constraints

- No official Inspiration API — Studio browser session only.
- Shared Studio profile + mutex with related-video work (`data/youtube-studio-profile/`).
- Domain has zero Playwright / cookie / Google imports.
- Sync failure must not fail clip/replay/ideate jobs.
- Stale ideas (`INSPIRATION_STALE_DAYS`, default 7): prompt soft-hint only; no boost/quota.
- Clip/replay: never invent windows to fill quota; generate may fill up to `INSPIRATION_GENERATE_FILL_MAX`.
- Conventional Commits; log start/steps/end + durations; never log cookies/SAPISID.
- Hexagonal boundaries; files stay focused (≤300 lines preferred).

## File map

| Path | Responsibility |
|------|----------------|
| `src/domain/inspiration.ts` | Types + token match + boost + quota reorder/fill helpers |
| `src/domain/inspiration-config.ts` | Parse/defaults for match/boost/quota/stale env knobs |
| `src/ports/inspiration-store.ts` | Persist sync runs, ideas, candidate links |
| `src/ports/youtube-studio-inspiration.ts` | `sync()` capture port |
| `src/adapters/youtube/studio-mutex.ts` | Shared async mutex for Studio automation |
| `src/adapters/youtube/studio-profile.ts` | Resolve profile dir + headed flag |
| `src/adapters/youtube/studio-inspiration.ts` | Playwright DOM scrape |
| `src/adapters/db/schema.ts` + `drizzle/0009_*.sql` | Tables |
| `src/adapters/db/repositories.ts` | Inspiration store impl |
| `src/application/sync-inspiration.ts` | Orchestrate capture → persist snapshot |
| `src/application/apply-inspiration-to-batch.ts` | Load active ideas, apply bias, write links |
| `src/application/inspiration-prompt-block.ts` | Format ideas for LLM user/system text |
| `src/application/schedule-inspiration-sync.ts` | Interval enqueue helper |
| `scripts/studio-login.ts` | Headed one-time Google login into profile |
| `src/workers/handlers.ts` + `queue-control.ts` | `sync_inspiration` job |
| `src/lib/env.ts` + `container.ts` | Wire deps + scheduler boot |
| `app/inspiration/page.tsx` + API route enqueue | Dashboard + Sync now |
| `app/layout.tsx` | Nav link |
| `app/candidates/*` | Inspiration chip when links exist |
| `tests/domain/inspiration*.ts` | Unit tests |
| `tests/application/sync-inspiration.test.ts` | Fake Studio port |
| `tests/application/apply-inspiration-to-batch.test.ts` | Bias wiring |

---

### Task 1: Domain match / boost / quota

**Files:**
- Create: `src/domain/inspiration.ts`
- Create: `src/domain/inspiration-config.ts`
- Test: `tests/domain/inspiration-match.test.ts`

**Interfaces:**
- Produces:
  - `InspirationIdea` (id, title, summary, suggestedTitles, outline, …)
  - `tokenize(text: string): string[]`
  - `alignmentScore(candidateText: string, idea: InspirationIdea): number`
  - `matchIdeas(candidateText: string, ideas: InspirationIdea[], minScore: number): { ideaIds: string[]; alignmentScore: number }`
  - `boostScore(score: number, alignment: number, boost: number): number`
  - `applyQuotaReorder(candidates: T[], isMatched: (c: T) => boolean, keepCount: number, quotaRatio: number): { ordered: T[]; shortfall: number }`
  - `selectIdeasForGenerateFill(ideas: InspirationIdea[], alreadyMatchedIds: Set<string>, maxFill: number): InspirationIdea[]`
  - `parseInspirationConfig(env: Record<string, string | undefined>): InspirationConfig`

- [ ] **Step 1: Write failing tests** covering token overlap, boost cap at 1, quota reorder preferring matched, shortfall count, generate-fill skips already matched, stale config defaults.

```ts
import { describe, expect, it } from "vitest";
import {
  alignmentScore,
  applyQuotaReorder,
  boostScore,
  matchIdeas,
  selectIdeasForGenerateFill,
} from "@/src/domain/inspiration";

describe("inspiration match", () => {
  it("scores overlapping tokens", () => {
    const idea = {
      id: "i1",
      title: "Oschersleben battle for P2",
      summary: "Door-to-door last laps",
      suggestedTitles: ["Last lap fight at Oschersleben"],
      outline: "Show the divebomb",
    };
    expect(alignmentScore("Oschersleben last lap battle", idea)).toBeGreaterThan(0.2);
  });

  it("boosts without exceeding 1", () => {
    expect(boostScore(0.95, 1, 0.12)).toBe(1);
  });

  it("reorders so matched fill quota first", () => {
    const items = [
      { id: "a", matched: false },
      { id: "b", matched: true },
      { id: "c", matched: false },
      { id: "d", matched: true },
    ];
    const { ordered, shortfall } = applyQuotaReorder(
      items,
      (c) => c.matched,
      4,
      0.4,
    );
    expect(ordered.slice(0, 2).every((c) => c.matched)).toBe(true);
    expect(shortfall).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/domain/inspiration-match.test.ts
```

- [ ] **Step 3: Implement domain helpers** (normalize lowercase, strip punctuation, Jaccard-like overlap on token sets; document formula in a one-line comment).

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/domain/inspiration.ts src/domain/inspiration-config.ts tests/domain/inspiration-match.test.ts
git commit -m "feat(domain): Inspiration match, boost, and quota helpers"
```

---

### Task 2: Schema + Inspiration store

**Files:**
- Modify: `src/adapters/db/schema.ts`
- Create: `drizzle/0009_inspiration.sql` (and update `drizzle/meta/_journal.json` via `npm run db:generate` if that is the project habit; otherwise hand-write SQL matching schema)
- Create: `src/ports/inspiration-store.ts`
- Modify: `src/adapters/db/repositories.ts` (add inspiration methods; extend `createRepositories` return)
- Test: `tests/adapters/inspiration-store.test.ts` (+ extend `tests/adapters/db-migrations.test.ts` if needed)

**Interfaces:**
- Produces `InspirationStorePort`:
  - `saveSyncRun(run)` / `listSyncRuns(limit)` / `getLatestOkSyncAt(): Date | null`
  - `replaceActiveIdeas(syncRunId, ideas[]): Promise<void>` (deactivate old, insert new active)
  - `listActiveIdeas(): Promise<InspirationIdeaRecord[]>`
  - `saveCandidateLinks(links: { candidateId; ideaId; alignmentScore }[]): Promise<void>`
  - `listLinksForCandidates(ids: string[]): Promise<…>`

Tables (per spec): `inspiration_sync_runs`, `inspiration_ideas`, `candidate_inspiration_links`.

- [ ] **Step 1: Failing migration/store test** — after migrate, replaceActiveIdeas leaves only new set `active=true`.

- [ ] **Step 2: Implement schema + SQL migration + repository**

- [ ] **Step 3: Run**

```bash
npx vitest run tests/adapters/inspiration-store.test.ts tests/adapters/db-migrations.test.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(db): Inspiration sync runs, ideas, and candidate links"
```

---

### Task 3: Studio profile, mutex, login script, Inspiration port stub

**Files:**
- Create: `src/adapters/youtube/studio-mutex.ts`
- Create: `src/adapters/youtube/studio-profile.ts`
- Create: `src/ports/youtube-studio-inspiration.ts`
- Create: `src/adapters/youtube/studio-inspiration.ts` (real scrape in Task 4; here can throw `StudioSessionUnavailableError` if profile missing)
- Create: `scripts/studio-login.ts`
- Modify: `package.json` — add `playwright` dependency; script `"studio:login": "tsx scripts/studio-login.ts"`
- Test: `tests/adapters/studio-mutex.test.ts`

**Interfaces:**
- `withStudioLock<T>(fn: () => Promise<T>): Promise<T>`
- `resolveStudioProfileDir(env): string`
- `YouTubeStudioInspirationPort.sync(): Promise<{ status: "ok" | "partial"; ideas: CapturedInspirationIdea[] }>`
- Typed errors: `StudioSessionUnavailableError`, `StudioInspirationUiError`

- [ ] **Step 1: Mutex test** — concurrent callers serialize.

- [ ] **Step 2: Implement mutex + profile path helper + login script** that launches persistent Chromium, opens `https://studio.youtube.com`, waits until URL/content indicates signed-in Studio (operator completes Google login), then exits 0.

- [ ] **Step 3: Add playwright**

```bash
npm install playwright
npx playwright install chromium
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(studio): shared Playwright profile mutex and login script"
```

---

### Task 4: Playwright Inspiration scraper

**Files:**
- Modify: `src/adapters/youtube/studio-inspiration.ts`
- Test: `tests/adapters/studio-inspiration.test.ts` (mock page object or skip live; prefer injectable `browserFactory` for unit test of parsers)

**Capture algorithm (DOM-first):**
1. `chromium.launchPersistentContext(profileDir, { headless: !headed })`
2. Goto Studio channel Content → click Inspiration tab (selectors may be IT/EN: `Inspiration` / text contains).
3. Collect idea card roots; for each: click open → read title, summary, audience interest, channel alignment, related interest block, outline, suggested titles, thumbnail notes → dismiss.
4. If zero cards: throw `StudioInspirationUiError`.
5. Always run inside `withStudioLock`.

Selectors will drift — isolate them in `INSPiration_SELECTORS` constants at top of file; log WARN per card failure and continue (`partial`).

- [ ] **Step 1: Implement parser helpers + adapter**

- [ ] **Step 2: Manual smoke (operator):** `npm run studio:login` then a small `tsx` one-off or unit with `YOUTUBE_STUDIO_HEADED=1` calling `sync()` once; not required in CI.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(studio): scrape YouTube Inspiration idea cards"
```

---

### Task 5: Sync application + worker job

**Files:**
- Create: `src/application/sync-inspiration.ts`
- Modify: `src/domain/queue-control.ts` — add `sync_inspiration: ["run"]`
- Modify: `src/workers/handlers.ts` — handler
- Modify: `src/lib/container.ts` — wire port + use case + handler deps
- Create: `app/api/inspiration/sync/route.ts` — POST enqueue `{ source: "manual" }`
- Test: `tests/application/sync-inspiration.test.ts`

**Interfaces:**
- `createSyncInspiration(deps).run({ source: "manual" | "scheduled" }): Promise<SyncRunSummary>`
- Flow: create run row → studio.sync() → replaceActiveIdeas → finish run ok/partial/failed with timing logs.

- [ ] **Step 1: Failing test** with fake Studio port returning 2 ideas; assert active list length 2 and previous deactivated.

- [ ] **Step 2: Implement use case + handler + API enqueue**

Payload: `{ source: "manual" | "scheduled" }`.

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/application/sync-inspiration.test.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(inspiration): sync job and manual enqueue API"
```

---

### Task 6: Scheduler

**Files:**
- Create: `src/application/schedule-inspiration-sync.ts`
- Modify: `src/lib/env.ts` — optional `INSPIRATION_SYNC_INTERVAL_HOURS` (default 24), plus optional bias knobs OR read bias knobs only in `inspiration-config` from `process.env` inside application (prefer env.ts for interval only to avoid breaking existing env tests)
- Modify: worker boot (`src/lib/container.ts` `startWorkers` or `scripts/run-workers.ts`) to `setInterval` enqueue when interval elapsed since `getLatestOkSyncAt` (also enqueue if never synced — once per interval max)

- [ ] **Step 1: Unit test** — if last ok sync was 25h ago and interval 24h, `shouldEnqueueInspirationSync` returns true; if 1h ago, false.

- [ ] **Step 2: Wire interval on worker start (clear on shutdown if applicable)**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(workers): schedule periodic Inspiration sync"
```

---

### Task 7: Apply bias to clip / replay / ideate

**Files:**
- Create: `src/application/inspiration-prompt-block.ts`
- Create: `src/application/apply-inspiration-to-batch.ts`
- Modify: `src/application/run-clip-analysis.ts` — inject prompt block before LLM; after building candidates call apply
- Modify: `src/application/run-replay-analysis.ts` — same
- Modify: `src/application/run-ideation.ts` — prompt + apply; on shortfall call generate fill (extra LLM ideas guided by unmatched Inspiration ideas, capped)
- Modify: `src/lib/container.ts` — pass store + config into those factories
- Test: `tests/application/apply-inspiration-to-batch.test.ts`
- Extend existing analysis/ideation tests with fake store (empty ideas = no-op)

**`applyInspirationToBatch` behavior:**
1. Load active ideas; if none → return candidates unchanged.
2. If stale → skip boost/quota/links; caller still may inject prompt (prompt block uses active ideas regardless of stale; hard bias gated here).
3. Else match each candidate → boost scores → quota reorder → save links → return ordered list (caller saves).

**Generate fill:** only in `run-ideation` after apply reports shortfall; second LLM call or append ideas from `selectIdeasForGenerateFill` turned into briefs (reuse ideation schema).

- [ ] **Step 1: Tests for apply (fresh boost+links, stale no boost, empty no-op)**

- [ ] **Step 2: Wire three pipelines**

- [ ] **Step 3: Run**

```bash
npx vitest run tests/application/apply-inspiration-to-batch.test.ts tests/application/run-clip-analysis.test.ts tests/application/run-ideation.test.ts tests/application/run-replay-analysis.test.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(inspiration): bias clip, replay, and ideate candidate batches"
```

---

### Task 8: UI `/inspiration` + candidates chip

**Files:**
- Create: `app/inspiration/page.tsx` (server component listing active ideas + sync history)
- Create: `app/components/InspirationSyncButton.tsx` (client POST `/api/inspiration/sync`)
- Modify: `app/layout.tsx` — nav `Inspiration`
- Modify: `app/candidates/page.tsx` (+ detail if needed) — chip when links exist
- Styles: reuse dashboard classes in `app/styles/dashboard.css` (minimal additions)
- Test: light UI test optional `tests/inspiration-ui.test.tsx` if project has RTL patterns for pages

- [ ] **Step 1: Build page** — active cards, expand details, sync runs table, Sync now, stale badge using `INSPIRATION_STALE_DAYS`.

- [ ] **Step 2: Candidates chip** — “Inspiration” linking to `/inspiration` or title tooltip.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(ui): Inspiration dashboard and candidate alignment chip"
```

---

### Task 9: Docs + verification

**Files:**
- Modify: `docs/overview.md` — one row for Inspiration sync / `/inspiration`
- Modify: `README.md` only if env table exists — document `YOUTUBE_STUDIO_PROFILE_DIR`, `studio:login`, interval
- Update spec status line to `Approved; implementation in progress` → after finish `Implemented`

- [ ] **Step 1: Doc touch-ups**

- [ ] **Step 2: Full verify**

```bash
npm test
npm run typecheck
```

- [ ] **Step 3: Daemon policy** — `npm run daemon:status`; restart only if RUNNING

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: document Inspiration sync and Studio login"
```

---

## Spec coverage check

| Spec section | Task(s) |
|--------------|---------|
| §2 Storage | 2 |
| §3 Studio sync + triggers | 3–6 |
| §4 Influence | 1, 7 |
| §5 UI | 8 |
| §6 Architecture | all |
| §7 Testing | 1–2, 5, 7 |
| §9 Config | 1, 6, 9 |

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-08-14-youtube-inspiration.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with checkpoints  

Which approach?
