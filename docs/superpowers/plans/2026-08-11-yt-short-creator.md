# YT Short Creator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a local Next.js app that analyzes a YouTube channel, proposes branded Shorts from clips and generation, and autonomously uploads only after human approval.

**Architecture:** Hexagonal TypeScript core (`domain` → `application` → `ports` ← `adapters`) behind a Next.js App Router UI on localhost. SQLite persists entities/jobs; an in-process worker runs download/analyze/render/upload with structured logging and progress events.

**Tech Stack:** Next.js 15 (App Router, TypeScript), Drizzle + SQLite, FFmpeg CLI, YouTube Data API v3 (OAuth), OpenAI-compatible LLM + TTS behind ports, pino logging, Vitest.

**Spec:** [docs/superpowers/specs/2026-08-11-yt-short-creator-design.md](../specs/2026-08-11-yt-short-creator-design.md)

## Global Constraints

- Personal repo under `Documents\Projects` → GitHub `marcatos`, **public**, Conventional Commits.
- Brand assets referenced via `BRAND_ROOT` (default sibling `../smarcato42-racing`), not fully vendored.
- Never publish without `ApproveCandidate`; upload runs only after successful render.
- Logging: DEBUG/INFO/WARN/ERROR, step timings, progress %, no secrets in logs.
- Hexagonal boundaries: domain has zero framework/IO imports.
- Files ideally ≤300 lines; split when exceeding.
- Both **clip** and **generate** paths required in first usable release.
- Artifact retention in any future CI upload steps: `retention-days: 7`.

---

## File map (create during tasks)

```
yt-short-creator/
  package.json
  tsconfig.json
  next.config.ts
  drizzle.config.ts
  vitest.config.ts
  .env.example
  .gitignore
  README.md
  src/
    domain/
      entities.ts
      status.ts
      approval.ts
    application/
      connect-channel.ts
      sync-channel.ts
      run-clip-analysis.ts
      run-ideation.ts
      list-candidates.ts
      get-candidate.ts
      update-candidate-metadata.ts
      approve-candidate.ts
      reject-candidate.ts
      request-revision.ts
      retry-failed-job.ts
      get-job-progress.ts
    ports/
      youtube-auth.ts
      youtube-catalog.ts
      youtube-upload.ts
      media-store.ts
      video-download.ts
      llm.ts
      tts.ts
      render.ts
      brand-pack.ts
      job-queue.ts
      clock.ts
      id.ts
      candidate-repository.ts
      job-repository.ts
      channel-repository.ts
      logger.ts
    adapters/
      logging/pino-logger.ts
      db/schema.ts
      db/client.ts
      db/repositories.ts
      jobs/in-process-queue.ts
      brand/fs-brand-pack.ts
      youtube/oauth.ts
      youtube/catalog.ts
      youtube/upload.ts
      media/fs-media-store.ts
      media/ytdlp-download.ts
      llm/openai-compatible.ts
      tts/openai-compatible-tts.ts
      ffmpeg/ffmpeg-render.ts
      system/clock.ts
      system/id.ts
    workers/
      handlers.ts
      runner.ts
    lib/
      env.ts
      container.ts
  app/
    layout.tsx
    page.tsx
    globals.css
    connect/page.tsx
    library/page.tsx
    candidates/page.tsx
    candidates/[id]/page.tsx
    jobs/page.tsx
    settings/page.tsx
    api/...
  tests/
    domain/
    application/
```

---

### Task 1: Scaffold project + logging + env

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore`, `.env.example`, `README.md`, `src/ports/logger.ts`, `src/adapters/logging/pino-logger.ts`, `src/lib/env.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`

**Interfaces:**
- Produces: `Logger` port; `loadEnv()` returning typed config including `BRAND_ROOT`, `LOG_LEVEL`, YouTube/LLM keys placeholders

- [ ] **Step 1: Initialize Next.js + deps**

```bash
cd C:\Users\simot\Documents\Projects\yt-short-creator
npx create-next-app@15 . --typescript --eslint --app --src-dir=false --tailwind=false --import-alias "@/*" --use-npm --turbopack=false
npm install pino pino-pretty zod drizzle-orm better-sqlite3
npm install -D vitest @types/better-sqlite3 drizzle-kit tsx
```

If the directory is non-empty (docs present), scaffold manually: write `package.json` with scripts `dev`, `build`, `start`, `test`, `db:generate`, `db:migrate` instead of wiping docs.

- [ ] **Step 2: Add `.gitignore` and `.env.example`**

`.gitignore` must include: `node_modules`, `.next`, `.env`, `.env.local`, `data/`, `media/`, `*.db`.

`.env.example`:

```env
LOG_LEVEL=INFO
BRAND_ROOT=C:\Users\simot\Documents\Projects\smarcato42-racing
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REDIRECT_URI=http://localhost:3000/api/auth/youtube/callback
LLM_API_KEY=
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4.1-mini
TTS_API_KEY=
TTS_BASE_URL=https://api.openai.com/v1
TTS_MODEL=gpt-4o-mini-tts
DATABASE_PATH=./data/app.db
MEDIA_ROOT=./media
```

- [ ] **Step 3: Implement `Logger` port + pino adapter**

```typescript
// src/ports/logger.ts
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(ctx: Record<string, unknown>): Logger;
}
```

Map `LOG_LEVEL` to pino; never log keys matching `/secret|token|password|api.?key/i`.

- [ ] **Step 4: Minimal branded home shell**

`app/globals.css` CSS variables from brand tokens (`--carbon`, `--ice`, `--rosso`). `app/page.tsx`: brand title “S.Marcato 42 Racing”, one line product purpose, CTA link to `/candidates`.

- [ ] **Step 5: README**

Document purpose, local run (`npm run dev`), required tools (FFmpeg, yt-dlp), `BRAND_ROOT`, OAuth setup pointers.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(scaffold): init Next.js app with logging and env"
```

---

### Task 2: Domain entities + approval state machine

**Files:**
- Create: `src/domain/entities.ts`, `src/domain/status.ts`, `src/domain/approval.ts`
- Test: `tests/domain/approval.test.ts`, `tests/domain/status.test.ts`

**Interfaces:**
- Produces: `ShortCandidate`, `transitionCandidate(candidate, event)`, `assertPublishable(candidate, renderSucceeded)`

- [ ] **Step 1: Write failing tests for transitions**

```typescript
// tests/domain/approval.test.ts
import { describe, it, expect } from "vitest";
import { applyCandidateEvent } from "@/src/domain/approval";
import type { ShortCandidate } from "@/src/domain/entities";

function base(): ShortCandidate {
  return {
    id: "c1",
    origin: "clip",
    status: "proposed",
    title: "Test",
    description: "",
    tags: [],
    score: 0.9,
    provenance: { sourceVideoId: "v1", startMs: 0, endMs: 10000, hookReason: "x", crop: { mode: "center_vertical", focusX: 0.5 } },
    scheduledAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("applyCandidateEvent", () => {
  it("approves from proposed", () => {
    const next = applyCandidateEvent(base(), { type: "approve" });
    expect(next.status).toBe("approved");
  });

  it("rejects publishable check without ready+render", () => {
    expect(() => applyCandidateEvent(base(), { type: "mark_publishing" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/domain/approval.test.ts
```

Expected: fail (module missing).

- [ ] **Step 3: Implement entities + transitions**

Implement statuses exactly as spec: `proposed | revising | approved | rejected | rendering | ready | publishing | published | failed`.

`assertCanPublish(c)` requires `status === "ready"` (render artifact implied by status `ready`).

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/domain
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(domain): add ShortCandidate status machine and approval invariants"
```

---

### Task 3: Ports + system adapters (clock, id)

**Files:**
- Create all files under `src/ports/*.ts` listed in file map
- Create: `src/adapters/system/clock.ts`, `src/adapters/system/id.ts`

**Interfaces:**
- Produces: TypeScript interfaces only for external deps; `UuidIdPort`, `SystemClock`

- [ ] **Step 1: Define repository + service ports** with method signatures used by later tasks:

```typescript
// src/ports/candidate-repository.ts
import type { ShortCandidate } from "@/src/domain/entities";

export interface CandidateRepository {
  save(c: ShortCandidate): Promise<void>;
  getById(id: string): Promise<ShortCandidate | null>;
  list(filter: { status?: string; origin?: string }): Promise<ShortCandidate[]>;
}
```

Mirror for channel, source video, generation brief, jobs.

```typescript
// src/ports/job-queue.ts
export interface JobQueuePort {
  enqueue(job: { type: string; payload: Record<string, unknown> }): Promise<string>;
  getProgress(jobId: string): Promise<{ pct: number; message: string } | null>;
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(ports): define hexagonal ports for YouTube media LLM and jobs"
```

---

### Task 4: SQLite schema + repositories

**Files:**
- Create: `src/adapters/db/schema.ts`, `src/adapters/db/client.ts`, `src/adapters/db/repositories.ts`, `drizzle.config.ts`
- Test: `tests/adapters/repositories.test.ts` (optional smoke with temp DB)

**Interfaces:**
- Consumes: domain entities, ports
- Produces: Drizzle repositories implementing `CandidateRepository`, `ChannelRepository`, `JobRepository`

- [ ] **Step 1: Define Drizzle tables** for `channels`, `source_videos`, `generation_briefs`, `short_candidates`, `render_jobs`, `publish_jobs` with JSON columns for provenance/tags.

- [ ] **Step 2: Implement `createDb(path)` ensuring `data/` exists.

- [ ] **Step 3: Implement repository mappers** (row ↔ entity).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(db): add SQLite schema and repositories via Drizzle"
```

---

### Task 5: In-process job queue + worker shell

**Files:**
- Create: `src/adapters/jobs/in-process-queue.ts`, `src/workers/handlers.ts`, `src/workers/runner.ts`
- Test: `tests/adapters/job-queue.test.ts`

**Interfaces:**
- Consumes: `JobQueuePort`, `Logger`
- Produces: queue that persists jobs, emits progress, runs handlers sequentially (concurrency 1)

- [ ] **Step 1: Failing test** — enqueue job, handler sets progress 50 then 100, `getProgress` reflects values.

- [ ] **Step 2: Implement queue** with statuses `queued|running|succeeded|failed|cancelled`; log start/end durations.

- [ ] **Step 3: Wire `runner.start()` from `src/lib/container.ts` on server boot (Next.js instrumentation or custom server entry). Prefer `instrumentation.ts` calling `startWorkers()`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(jobs): add in-process queue with progress and worker runner"
```

---

### Task 6: Brand pack adapter

**Files:**
- Create: `src/adapters/brand/fs-brand-pack.ts`
- Test: `tests/adapters/brand-pack.test.ts`

**Interfaces:**
- Consumes: `BRAND_ROOT`
- Produces: `BrandPackPort.resolve()` → tokens + paths to stacked logo, story template, accent hex

- [ ] **Step 1: Test** that reading `brand-identity/brand-tokens.json` returns `colors.carbon === "#08080A"` and `racing_colors.rosso_corsa.hex === "#E10600"` when `BRAND_ROOT` points at `smarcato42-racing`.

- [ ] **Step 2: Implement FS adapter**; throw clear error if tokens file missing.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(brand): resolve S.Marcato 42 tokens and asset paths"
```

---

### Task 7: YouTube OAuth + catalog sync

**Files:**
- Create: `src/adapters/youtube/oauth.ts`, `src/adapters/youtube/catalog.ts`
- Create: `app/api/auth/youtube/route.ts`, `app/api/auth/youtube/callback/route.ts`
- Create: `src/application/connect-channel.ts`, `src/application/sync-channel.ts`
- Create: `app/connect/page.tsx`, `app/library/page.tsx`

**Interfaces:**
- Consumes: `YouTubeAuthPort`, `YouTubeCatalogPort`, channel repo
- Produces: connected `Channel`; synced `SourceVideo[]` metadata (no media download yet)

- [ ] **Step 1: Implement OAuth** authorization URL + callback storing refresh token in `data/youtube-tokens.json` (gitignored). Scopes: `youtube.upload`, `youtube.readonly` (add analytics scope only if used).

- [ ] **Step 2: Catalog adapter** lists channel uploads playlist items + snippet/contentDetails.

- [ ] **Step 3: Use cases** `connectChannel`, `syncChannel` with logging + timing.

- [ ] **Step 4: UI** Connect button; Library table of videos.

- [ ] **Step 5: Manual check** — open `/connect`, complete OAuth, see channel title on home.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(youtube): OAuth connect and channel catalog sync"
```

---

### Task 8: Media store + yt-dlp download

**Files:**
- Create: `src/adapters/media/fs-media-store.ts`, `src/adapters/media/ytdlp-download.ts`
- Extend: worker handler `download_source_video`

**Interfaces:**
- `VideoDownloadPort.download(youtubeVideoId): Promise<string>` local path
- Skip download if file exists and size > 0 (performance)

- [ ] **Step 1: Implement media store** paths under `MEDIA_ROOT/sources|renders|audio|broll`.

- [ ] **Step 2: yt-dlp adapter** invoking CLI; log duration; progress via stderr parse when possible.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(media): local media store and yt-dlp source download"
```

---

### Task 9: LLM port + clip analysis use case

**Files:**
- Create: `src/adapters/llm/openai-compatible.ts`
- Create: `src/application/run-clip-analysis.ts`
- Create: worker handler `analyze_clips`
- Test: `tests/application/run-clip-analysis.test.ts` with fake LLM + fake download

**Interfaces:**
- `LlmPort.complete({ system, user, jsonSchema? })`
- `runClipAnalysis({ sourceVideoId })` → saves `ShortCandidate[]` origin `clip`

- [ ] **Step 1: Fake-port test** — LLM returns one window; expect candidate `proposed` with provenance timestamps.

- [ ] **Step 2: Implement analyzer** — captions if available else transcript hook via LLM on sampled description/title + optional chunked captions file from yt-dlp `--write-auto-subs`.

- [ ] **Step 3: Library UI button** “Analyze clips” enqueues jobs; candidates appear in `/candidates`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(clip): LLM moment analysis producing ShortCandidates"
```

---

### Task 10: Generate path (ideation + TTS + timeline)

**Files:**
- Create: `src/application/run-ideation.ts`
- Create: `src/adapters/tts/openai-compatible-tts.ts`
- Create: worker handlers `ideate`, `assemble_generate_preview`
- Test: `tests/application/run-ideation.test.ts`

**Interfaces:**
- `runIdeation({ channelId, count })` creates `GenerationBrief` + `ShortCandidate` origin `generate`
- TTS writes audio under `media/audio/`
- B-roll: pick files from `media/broll` round-robin; if empty, still produce candidate with script-only preview note in UI

- [ ] **Step 1: Test ideation** with fake LLM returns hook/script; candidate saved.

- [ ] **Step 2: Implement TTS adapter** + assemble timeline JSON in provenance.

- [ ] **Step 3: UI** “Generate Shorts ideas” on home or library.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(generate): ideation TTS and generate-origin candidates"
```

---

### Task 11: FFmpeg brand render

**Files:**
- Create: `src/adapters/ffmpeg/ffmpeg-render.ts`
- Create: worker handler `render_short`
- Test: `tests/adapters/ffmpeg-render.test.ts` (skip if ffmpeg missing; otherwise render 1s color + overlay)

**Interfaces:**
- `RenderPort.render(input): Promise<{ outputPath }>`  
  Clip: trim + scale/crop 1080x1920 + overlay logo PNG + optional subtitle drawtext  
  Generate: concat broll to VO length + same overlays

- [ ] **Step 1: Implement filter graph** using brand accent bar and logo from `BrandPackPort`; carbon letterbox if needed.

- [ ] **Step 2: On render success** transition candidate `rendering` → `ready`; save `RenderJob`.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(render): FFmpeg 9:16 export with S.Marcato brand overlays"
```

---

### Task 12: Approval use cases + YouTube upload

**Files:**
- Create: `src/application/approve-candidate.ts`, `reject-candidate.ts`, `request-revision.ts`, `update-candidate-metadata.ts`, `retry-failed-job.ts`
- Create: `src/adapters/youtube/upload.ts`
- Create: worker handler `publish_short`
- Test: `tests/application/approve-candidate.test.ts`

**Interfaces:**
- `approveCandidate` → status `approved` → enqueue `render_short` then chain `publish_short` when ready
- `YouTubeUploadPort.upload({ filePath, title, description, tags, scheduledAt })` appends `#Shorts` if missing
- Fake upload in unit tests

- [ ] **Step 1: Tests** — approve enqueues render; after fake render success, publish called once; reject never calls upload.

- [ ] **Step 2: Implement upload adapter** resumable upload; persist YouTube video id on `PublishJob`; transition to `published`.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(publish): approve gate and autonomous YouTube Short upload"
```

---

### Task 13: Candidates + jobs UI (approval surface)

**Files:**
- Create: `app/candidates/page.tsx`, `app/candidates/[id]/page.tsx`, `app/jobs/page.tsx`, `app/settings/page.tsx`
- Create: API routes under `app/api/candidates/`, `app/api/jobs/`, `app/api/settings/`
- Create: UI components under `app/components/` (`CandidateQueue`, `ReviewPanel`, `JobProgress`)

**Interfaces:**
- Consumes: list/get/update/approve/reject/revise use cases
- Brand styling from CSS variables; Approve button Rosso

- [ ] **Step 1: Queue page** with filters status/origin.

- [ ] **Step 2: Detail page** 9:16 video preview (`<video>` on render output or source with `#t=`), metadata editors, Approve / Reject / Revise, optional schedule.

- [ ] **Step 3: Jobs page** progress % + message polling `GET /api/jobs/:id/progress`.

- [ ] **Step 4: Settings** brand path display, log level, default privacy (`public`), mask secrets.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ui): candidates review queue jobs and settings dashboard"
```

---

### Task 14: Composition root + end-to-end smoke path

**Files:**
- Create: `src/lib/container.ts`, `instrumentation.ts`
- Modify: API routes to use container
- Create: `tests/application/pipeline.smoke.test.ts` with all fakes

**Interfaces:**
- Single `createContainer(env)` wires adapters; used by route handlers and workers

- [ ] **Step 1: Smoke test** — ideation or clip fake → approve → render fake → publish fake → `published`.

- [ ] **Step 2: README “Acceptance”** section: real OAuth unlisted upload checklist.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(app): wire composition root and pipeline smoke test"
```

---

### Task 15: GitHub remote + baseline CI (optional lint/test)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Ensure `gh` account `marcatos`**, create public repo, push `main`.

```bash
gh auth switch --user marcatos
gh repo create yt-short-creator --public --source=. --remote=origin --push --description "Local S.Marcato 42 Racing tool: analyze YouTube, propose branded Shorts, approve, auto-upload"
```

- [ ] **Step 2: CI workflow** — `npm ci`, `npm test`, `npm run build`. If uploading artifacts, set `retention-days: 7`.

- [ ] **Step 3: Commit + push**

```bash
git commit -m "ci: add test and build workflow with 7-day artifact retention"
git push -u origin HEAD
```

---

## Spec coverage checklist

| Spec requirement | Task(s) |
|------------------|---------|
| OAuth connect one channel | 7 |
| Sync metadata + download for clips | 7, 8 |
| Analyze moments / themes | 9, 10 |
| Clip path propose → preview → render | 9, 11, 13 |
| Generate path script/VO/B-roll | 10, 11 |
| Dashboard queue + approve/reject/revise | 13 |
| Autonomous upload after approve | 12 |
| Brand pack integration | 6, 11, 13 |
| Logging + progress | 1, 5 |
| Hexagonal layout | 2–12 |
| No publish without approval | 2, 12 |
| Out of scope respected | — (no multi-tenant/NLE/cross-post tasks) |

## Placeholder / consistency self-review

- Status names match design spec enums.
- Shared path: both origins become `ShortCandidate` → render → publish.
- No TBD steps; fakes defined for CI where real YouTube/FFmpeg unavailable.
