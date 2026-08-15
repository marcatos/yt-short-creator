# Operator Match Shorts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator pick library videos + Inspiration ideas, rank top-K pairs, and run `match_propose_shorts` to produce idea-constrained clip candidates plus generate fill into the review queue.

**Architecture:** Pure domain ranking (`scoreVideoIdeaPair` / `rankVideoIdeaPairs`) feeds a `/match` UI preview. Run enqueues `match_propose_shorts`, which loops accepted pairs through idea-subset clip analysis, then generate-fill from under-represented selected ideas. Reuses `applyInspirationToBatch` with `ideaIds` + `bypassStaleGate`.

**Tech Stack:** Next.js App Router, existing SQLite job queue, Vitest, domain in `src/domain/inspiration.ts`, application use cases under `src/application/`.

**Spec:** `docs/superpowers/specs/2026-08-15-operator-match-shorts-design.md`

## Global Constraints

- Brand: carbon / ice / rosso; shell sidebar already present.
- No embeddings in v1.
- Ranking defaults: align 0.40, studio 0.25, analytics 0.25, fresh 0.10.
- Default K=5; ≤1 idea per video in greedy selection.
- Operator-selected ideas bypass Inspiration stale gate for bias.
- Publish still requires human Approve.
- Conventional Commits; commit each task; push when stream finishes; restart daemon only if RUNNING.
- Logging: start / steps / end / durations; no secrets.

## File map

| File | Responsibility |
|------|----------------|
| `src/domain/inspiration.ts` | Pair scoring + rank greedy |
| `tests/domain/inspiration-match.test.ts` | Extend with pair ranking tests |
| `src/application/apply-inspiration-to-batch.ts` | `ideaIds?`, `bypassStaleGate?` |
| `src/application/inspiration-prompt-block.ts` | Load/format idea subset |
| `src/application/run-clip-analysis.ts` | `ideaIds?` constrained prompt + apply |
| `src/application/run-match-propose-shorts.ts` | Orchestrator |
| `src/domain/queue-control.ts` | Register job checkpoints |
| `src/workers/handlers.ts` | Handler wiring |
| `src/lib/container.ts` | Wire use case |
| `app/api/match/preview/route.ts` | Rank preview API |
| `app/api/match/run/route.ts` | Enqueue run |
| `app/match/page.tsx` + client board | UI |
| `app/components/NavSidebar.tsx` | Pipeline → Match |
| `tests/application/run-match-propose-shorts.test.ts` | Orchestrator smoke |
| `tests/match-ui.test.tsx` | Light UI |

---

### Task 1: Domain pair ranking

**Files:**
- Modify: `src/domain/inspiration.ts`
- Test: `tests/domain/inspiration-match.test.ts`

**Interfaces:**
- Produces:
  - `MatchPairWeights = { align: number; studio: number; analytics: number; fresh: number }`
  - `DEFAULT_MATCH_PAIR_WEIGHTS`
  - `VideoMatchInput = { id: string; title: string; viewCount?: number | null; likeCount?: number | null; commentCount?: number | null }`
  - `VideoIdeaPairScore = { sourceVideoId: string; ideaId: string; pairScore: number; align: number; studio: number; analytics: number; fresh: number }`
  - `studioSignalScore(idea: InspirationIdea): number`
  - `analyticsScore(video: VideoMatchInput, cohort: VideoMatchInput[]): number`
  - `freshScore(input: { ideaCapturedAt: Date; latestSuccessfulSyncAt: Date | null; now: Date; staleDays: number }): number`
  - `scoreVideoIdeaPair(...): VideoIdeaPairScore`
  - `rankVideoIdeaPairs(videos, ideas, opts): VideoIdeaPairScore[]`

- [ ] **Step 1: Write failing tests**

Append to `tests/domain/inspiration-match.test.ts`:

```ts
import {
  DEFAULT_MATCH_PAIR_WEIGHTS,
  rankVideoIdeaPairs,
  scoreVideoIdeaPair,
  studioSignalScore,
} from "@/src/domain/inspiration";

it("scores studio signal higher when idea fields are rich", () => {
  expect(
    studioSignalScore({
      id: "a",
      title: "t",
      summary: "s",
      suggestedTitles: [],
      outline: "",
    }),
  ).toBeLessThan(
    studioSignalScore({
      id: "b",
      title: "t",
      summary: "s",
      suggestedTitles: ["x"],
      outline: "o",
      audienceInterest: "fans",
      channelAlignment: "craft",
      relatedInterest: { items: ["safety car"] },
    }),
  );
});

it("ranks pairs and keeps at most one idea per video", () => {
  const videos = [
    { id: "v1", title: "wet race oschersleben", viewCount: 1000, likeCount: 50, commentCount: 10 },
    { id: "v2", title: "dry qualifying monza", viewCount: 100, likeCount: 5, commentCount: 1 },
  ];
  const ideas = [
    {
      id: "i1",
      title: "Wet qualifying drama",
      summary: "Rain at oschersleben",
      suggestedTitles: ["Wet race"],
      outline: "spray",
      audienceInterest: "fans",
      channelAlignment: "craft",
    },
    {
      id: "i2",
      title: "Monza start chaos",
      summary: "First lap monza",
      suggestedTitles: [],
      outline: "",
    },
  ];
  const ranked = rankVideoIdeaPairs(videos, ideas, {
    k: 2,
    now: new Date("2026-08-15T12:00:00.000Z"),
    latestSuccessfulSyncAt: new Date("2026-08-14T12:00:00.000Z"),
    staleDays: 7,
    ideaCapturedAtById: {
      i1: new Date("2026-08-14T12:00:00.000Z"),
      i2: new Date("2026-08-14T12:00:00.000Z"),
    },
    weights: DEFAULT_MATCH_PAIR_WEIGHTS,
  });
  expect(ranked).toHaveLength(2);
  expect(new Set(ranked.map((p) => p.sourceVideoId)).size).toBe(2);
  expect(ranked[0].pairScore).toBeGreaterThanOrEqual(ranked[1].pairScore);
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/domain/inspiration-match.test.ts
```

- [ ] **Step 3: Implement ranking helpers in `src/domain/inspiration.ts`**

Add (keep existing exports):

```ts
export type MatchPairWeights = {
  align: number;
  studio: number;
  analytics: number;
  fresh: number;
};

export const DEFAULT_MATCH_PAIR_WEIGHTS: MatchPairWeights = {
  align: 0.4,
  studio: 0.25,
  analytics: 0.25,
  fresh: 0.1,
};

export type VideoMatchInput = {
  id: string;
  title: string;
  viewCount?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
};

export type VideoIdeaPairScore = {
  sourceVideoId: string;
  ideaId: string;
  pairScore: number;
  align: number;
  studio: number;
  analytics: number;
  fresh: number;
};

export function studioSignalScore(idea: InspirationIdea): number {
  let score = 0;
  if (idea.audienceInterest?.trim()) score += 0.25;
  if (idea.channelAlignment?.trim()) score += 0.25;
  if (idea.relatedInterest != null) score += 0.25;
  if (idea.outline?.trim() || idea.suggestedTitles.length > 0) score += 0.25;
  return Math.min(1, score);
}

function log1p(n: number): number {
  return Math.log1p(Math.max(0, n));
}

export function analyticsScore(
  video: VideoMatchInput,
  cohort: VideoMatchInput[],
): number {
  const views = cohort.map((v) => log1p(v.viewCount ?? 0));
  const likes = cohort.map((v) => log1p(v.likeCount ?? 0));
  const comments = cohort.map((v) => log1p(v.commentCount ?? 0));
  const maxViews = Math.max(...views, 1e-9);
  const maxLikes = Math.max(...likes, 1e-9);
  const maxComments = Math.max(...comments, 1e-9);
  const v = log1p(video.viewCount ?? 0) / maxViews;
  const l = log1p(video.likeCount ?? 0) / maxLikes;
  const c = log1p(video.commentCount ?? 0) / maxComments;
  return Math.min(1, 0.5 * v + 0.3 * l + 0.2 * c);
}

export function freshScore(input: {
  ideaCapturedAt: Date;
  latestSuccessfulSyncAt: Date | null;
  now: Date;
  staleDays: number;
}): number {
  if (!input.latestSuccessfulSyncAt) return 0.2;
  const ageMs = input.now.getTime() - input.latestSuccessfulSyncAt.getTime();
  const staleMs = input.staleDays * 24 * 60 * 60 * 1000;
  if (ageMs > staleMs) return 0.25;
  const sameSync =
    Math.abs(
      input.ideaCapturedAt.getTime() - input.latestSuccessfulSyncAt.getTime(),
    ) <
    24 * 60 * 60 * 1000;
  return sameSync ? 1 : 0.7;
}

export function scoreVideoIdeaPair(input: {
  video: VideoMatchInput;
  idea: InspirationIdea;
  cohort: VideoMatchInput[];
  ideaCapturedAt: Date;
  latestSuccessfulSyncAt: Date | null;
  now: Date;
  staleDays: number;
  weights?: MatchPairWeights;
}): VideoIdeaPairScore {
  const weights = input.weights ?? DEFAULT_MATCH_PAIR_WEIGHTS;
  const align = alignmentScore(input.video.title, input.idea);
  const studio = studioSignalScore(input.idea);
  const analytics = analyticsScore(input.video, input.cohort);
  const fresh = freshScore({
    ideaCapturedAt: input.ideaCapturedAt,
    latestSuccessfulSyncAt: input.latestSuccessfulSyncAt,
    now: input.now,
    staleDays: input.staleDays,
  });
  const pairScore =
    weights.align * align +
    weights.studio * studio +
    weights.analytics * analytics +
    weights.fresh * fresh;
  return {
    sourceVideoId: input.video.id,
    ideaId: input.idea.id,
    pairScore,
    align,
    studio,
    analytics,
    fresh,
  };
}

export function rankVideoIdeaPairs(
  videos: VideoMatchInput[],
  ideas: InspirationIdea[],
  opts: {
    k: number;
    now: Date;
    latestSuccessfulSyncAt: Date | null;
    staleDays: number;
    ideaCapturedAtById: Record<string, Date>;
    weights?: MatchPairWeights;
  },
): VideoIdeaPairScore[] {
  const all: VideoIdeaPairScore[] = [];
  for (const video of videos) {
    for (const idea of ideas) {
      all.push(
        scoreVideoIdeaPair({
          video,
          idea,
          cohort: videos,
          ideaCapturedAt:
            opts.ideaCapturedAtById[idea.id] ?? opts.now,
          latestSuccessfulSyncAt: opts.latestSuccessfulSyncAt,
          now: opts.now,
          staleDays: opts.staleDays,
          weights: opts.weights,
        }),
      );
    }
  }
  all.sort((a, b) => b.pairScore - a.pairScore);
  const usedVideos = new Set<string>();
  const selected: VideoIdeaPairScore[] = [];
  for (const pair of all) {
    if (usedVideos.has(pair.sourceVideoId)) continue;
    selected.push(pair);
    usedVideos.add(pair.sourceVideoId);
    if (selected.length >= opts.k) break;
  }
  return selected;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/domain/inspiration-match.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/inspiration.ts tests/domain/inspiration-match.test.ts
git commit -m "feat(match): add video×inspiration composite pair ranking"
```

---

### Task 2: Idea-subset apply + prompt load

**Files:**
- Modify: `src/application/apply-inspiration-to-batch.ts`
- Modify: `src/application/inspiration-prompt-block.ts`
- Test: `tests/application/apply-inspiration-to-batch.test.ts`

**Interfaces:**
- Produces: `ApplyInspirationInput` gains `ideaIds?: string[]`, `bypassStaleGate?: boolean`
- Produces: `loadInspirationPromptBlock(store, ideaIds?: string[])`

- [ ] **Step 1: Extend apply-batch tests**

Add a case: when `ideaIds: ["only-this"]` and `bypassStaleGate: true`, even if sync is stale, links are written only for that idea.

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run tests/application/apply-inspiration-to-batch.test.ts
```

- [ ] **Step 3: Implement**

In `applyInspirationToBatch`:

```ts
type ApplyInspirationInput = {
  // ...existing
  ideaIds?: string[];
  bypassStaleGate?: boolean;
};
```

After `listActiveIdeas()`, filter:

```ts
let records = await input.store.listActiveIdeas();
if (input.ideaIds?.length) {
  const allow = new Set(input.ideaIds);
  records = records.filter((r) => allow.has(r.id));
}
```

Stale check:

```ts
const stale =
  !input.bypassStaleGate &&
  isStale(latestSuccessfulSyncAt, input.clock.now(), input.config.staleDays);
```

In `inspiration-prompt-block.ts`:

```ts
export async function loadInspirationPromptBlock(
  store: InspirationStorePort | undefined,
  ideaIds?: string[],
): Promise<string> {
  if (!store) return "";
  let records = await store.listActiveIdeas();
  if (ideaIds?.length) {
    const allow = new Set(ideaIds);
    records = records.filter((r) => allow.has(r.id));
  }
  return formatInspirationPromptBlock(records.map(recordToInspirationIdea));
}
```

- [ ] **Step 4: Tests PASS**

```bash
npx vitest run tests/application/apply-inspiration-to-batch.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/application/apply-inspiration-to-batch.ts src/application/inspiration-prompt-block.ts tests/application/apply-inspiration-to-batch.test.ts
git commit -m "feat(inspiration): support idea subset and bypass stale for Match"
```

---

### Task 3: Constrained clip analysis

**Files:**
- Modify: `src/application/run-clip-analysis.ts`
- Test: `tests/application/run-clip-analysis.test.ts` (extend or add case)

**Interfaces:**
- Produces: `RunClipAnalysis = (input: { sourceVideoId: string; ideaIds?: string[] }) => Promise<ShortCandidate[]>`

- [ ] **Step 1: Failing test** — clip analysis with `ideaIds: ["idea-1"]` calls prompt loader / apply with that id (mock store returns two ideas; only idea-1 linked).

- [ ] **Step 2: Run FAIL**

```bash
npx vitest run tests/application/run-clip-analysis.test.ts
```

- [ ] **Step 3: Implement**

```ts
export type RunClipAnalysis = (input: {
  sourceVideoId: string;
  ideaIds?: string[];
}) => Promise<ShortCandidate[]>;

// inside:
inspirationBlock = await loadInspirationPromptBlock(
  deps.inspirationStore,
  ideaIds,
);
// strengthen user prompt when ideaIds present:
if (ideaIds?.length) {
  userParts.push(
    "Prioritize moments that best serve the Inspiration idea(s) above. Do not invent footage facts.",
  );
}
// apply:
await applyInspirationToBatchIfConfigured({
  ...,
  ideaIds,
  bypassStaleGate: Boolean(ideaIds?.length),
});
```

Pass `ideaIds` through from the returned async function args.

- [ ] **Step 4: PASS + commit**

```bash
git commit -m "feat(clips): allow Inspiration ideaIds constraint on analyze"
```

---

### Task 4: Orchestrator `run-match-propose-shorts`

**Files:**
- Create: `src/application/run-match-propose-shorts.ts`
- Test: `tests/application/run-match-propose-shorts.test.ts`

**Interfaces:**
- Consumes: `RunClipAnalysis`, ideation fill helpers (extract or call `createRunIdeation` fill path lightly)
- Produces: `createRunMatchProposeShorts(deps) => (input: { pairs: { sourceVideoId: string; ideaId: string }[]; channelId: string; onProgress?: ... }) => Promise<{ candidates: ShortCandidate[]; pairResults: ... }>`

- [ ] **Step 1: Write smoke test** with fake `runClipAnalysis` returning 1 candidate per pair, fake fill returning 1 generate candidate when shortfall; assert total candidates and progress callbacks.

- [ ] **Step 2: FAIL**

```bash
npx vitest run tests/application/run-match-propose-shorts.test.ts
```

- [ ] **Step 3: Implement orchestrator**

```ts
export type MatchPair = { sourceVideoId: string; ideaId: string };

export function createRunMatchProposeShorts(deps: {
  runClipAnalysis: RunClipAnalysis;
  runIdeationFill: (input: {
    channelId: string;
    ideaIds: string[];
    shortfall: number;
    matchedIdeaIds: string[];
  }) => Promise<ShortCandidate[]>;
  logger: Logger;
  inspirationConfig?: InspirationConfig;
}) {
  const log = deps.logger.child({ operation: "runMatchProposeShorts" });
  return async (input: {
    pairs: MatchPair[];
    channelId: string;
    onProgress?: (pct: number, message: string) => void | Promise<void>;
  }) => {
    const started = performance.now();
    log.info("Match propose started", { pairCount: input.pairs.length });
    const all: ShortCandidate[] = [];
    const matchedIdeaIds = new Set<string>();
    let successes = 0;
    for (let i = 0; i < input.pairs.length; i++) {
      const pair = input.pairs[i];
      await input.onProgress?.(
        Math.round((i / Math.max(input.pairs.length, 1)) * 80),
        `Pair ${i + 1}/${input.pairs.length}`,
      );
      try {
        const created = await deps.runClipAnalysis({
          sourceVideoId: pair.sourceVideoId,
          ideaIds: [pair.ideaId],
        });
        all.push(...created);
        if (created.length > 0) {
          successes += 1;
          matchedIdeaIds.add(pair.ideaId);
        }
      } catch (error) {
        log.warn("Match pair failed; continuing", {
          ...pair,
          error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
        });
      }
    }
    const fillMax = deps.inspirationConfig?.generateFillMax ?? 3;
    const quotaRatio = deps.inspirationConfig?.quotaRatio ?? 0.4;
    const target = Math.ceil(Math.max(all.length, input.pairs.length) * quotaRatio);
    const shortfall = Math.max(0, target - matchedIdeaIds.size, fillMax > 0 && successes < input.pairs.length ? 1 : 0);
    // Prefer: if any pair yielded 0, fill at least for uncovered selected ideas
    const selectedIdeaIds = input.pairs.map((p) => p.ideaId);
    const uncovered = selectedIdeaIds.filter((id) => !matchedIdeaIds.has(id));
    const fillCount = Math.min(fillMax, Math.max(shortfall, uncovered.length));
    let fill: ShortCandidate[] = [];
    if (fillCount > 0) {
      await input.onProgress?.(90, "Generate fill");
      fill = await deps.runIdeationFill({
        channelId: input.channelId,
        ideaIds: uncovered.length > 0 ? uncovered : selectedIdeaIds,
        shortfall: fillCount,
        matchedIdeaIds: [...matchedIdeaIds],
      });
      all.push(...fill);
    }
    await input.onProgress?.(100, "Done");
    log.info("Match propose completed", {
      pairCount: input.pairs.length,
      successes,
      clipCandidates: all.length - fill.length,
      fillCandidates: fill.length,
      durationMs: Math.round(performance.now() - started),
    });
    if (successes === 0 && fill.length === 0) {
      throw new Error("Match propose produced no candidates");
    }
    return { candidates: all, successes, fillCount: fill.length };
  };
}
```

Wire `runIdeationFill` in container by extracting a small helper from `run-ideation.ts` **or** duplicating a thin fill-only function in the same file that accepts `ideaIds` (prefer export `createInspirationGenerateFill` from `run-ideation.ts` to avoid duplication).

- [ ] **Step 4: PASS + commit**

```bash
git commit -m "feat(match): orchestrate pair clip analyze and generate fill"
```

---

### Task 5: Queue, worker, container, APIs

**Files:**
- Modify: `src/domain/queue-control.ts` — add `match_propose_shorts: ["run"]`
- Modify: `src/workers/handlers.ts`
- Modify: `src/lib/container.ts`
- Create: `app/api/match/preview/route.ts`
- Create: `app/api/match/run/route.ts`
- Test: extend jobs route tests or add `tests/match-api-routes.test.ts`

**Payload:**

```ts
{
  type: "match_propose_shorts",
  payload: {
    channelId: string,
    pairs: { sourceVideoId: string; ideaId: string }[],
  }
}
```

- [ ] **Step 1: Register job + handler** calling `container.runMatchProposeShorts` with `ctx.reportProgress`.

- [ ] **Step 2: Preview API** — body `{ sourceVideoIds: string[]; ideaIds: string[]; k?: number }` → load videos/ideas → `rankVideoIdeaPairs` → JSON.

- [ ] **Step 3: Run API** — body `{ channelId: string; pairs: MatchPair[] }` validate non-empty → enqueue job → `{ ok: true, jobId }`.

- [ ] **Step 4: Tests for validation (400 if empty) + commit**

```bash
git commit -m "feat(match): add match_propose_shorts job and preview/run APIs"
```

---

### Task 6: `/match` UI + nav

**Files:**
- Create: `app/match/page.tsx` (server: load channel, videos, ideas, stale flag)
- Create: `app/components/MatchBoard.tsx` (client: selection, K, preview fetch, run)
- Modify: `app/components/NavSidebar.tsx` — insert `{ href: "/match", label: "Match" }` after Library
- Modify: `tests/layout-density-ui.test.tsx` or add `tests/match-ui.test.tsx`
- CSS: extend `app/styles/dashboard.css` with match pickers / pair table (reuse filter-bar, pulse, compact-row patterns)

**UI behavior:**
1. Checkboxes for videos + ideas.
2. `K` number input default 5.
3. **Preview** button or auto-preview debounce → `POST /api/match/preview`.
4. Pair table with component scores + checkbox (default all selected).
5. **Run match** → `POST /api/match/run` → show job queued + link `/jobs`.
6. Disable Run until ≥1 video, ≥1 idea, ≥1 accepted pair.

- [ ] **Step 1: UI test** — page contains “Match”, pickers disabled run without selection.

- [ ] **Step 2: Implement page + board + nav**

- [ ] **Step 3: PASS UI tests + commit**

```bash
git commit -m "feat(ui): add /match desk for video×inspiration pairing"
```

---

### Task 7: Docs + verify + ship

**Files:**
- Modify: `docs/overview.md` — route row for `/match`
- Modify: `docs/superpowers/specs/2026-08-15-operator-match-shorts-design.md` — Status: Implemented

- [ ] **Step 1: Update overview**

- [ ] **Step 2: Run focused suite**

```bash
npx vitest run tests/domain/inspiration-match.test.ts tests/application/apply-inspiration-to-batch.test.ts tests/application/run-match-propose-shorts.test.ts tests/match-ui.test.tsx
```

- [ ] **Step 3: Commit docs, push `main`, `npm run daemon:status` and restart only if RUNNING**

```bash
git commit -m "docs(match): document Match route and mark design implemented"
git push origin HEAD
npm run daemon:status
# if RUNNING: npm run daemon:restart
```

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| `/match` pickers + ranking preview | 1, 5, 6 |
| Composite score weights | 1 |
| ≤1 idea/video greedy | 1 |
| Run → `match_propose_shorts` | 4, 5 |
| Idea-constrained analyze | 2, 3, 4 |
| Generate fill | 4 |
| Bypass stale for operator selection | 2, 3 |
| Jobs progress | 4, 5 |
| Candidates proposed | 3, 4 |
| Unit tests | 1–6 |
| No embeddings | Global |

## Placeholder scan

No TBD / “implement later” steps remaining.
