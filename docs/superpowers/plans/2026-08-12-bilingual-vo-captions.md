# Bilingual VO + Word-Sync Captions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce Italian and English voice-over variants (same brand voice) with Whisper word timing, ASS burn-in on Shorts, soft SRT for YouTube, and dual IT/EN uploads for Shorts and full races.

**Architecture:** Extend hexagonal ports (TTS instructions, word-level transcription, caption writers, YouTube captions). Application use cases generate scripts → TTS → align → FFmpeg mix/duck + optional burn-in → dual publish. VO path is opt-in beside the existing non-VO Short pipeline.

**Tech Stack:** Next.js 15, TypeScript, FFmpeg, OpenAI-compatible TTS (`gpt-4o-mini-tts` / configurable), Whisper `verbose_json` with word timestamps, YouTube Data API v3 captions, Vitest, existing SQLite/Drizzle job queue.

**Spec:** `docs/superpowers/specs/2026-08-12-bilingual-vo-captions-design.md`

## Global Constraints

- Languages: always generate **IT first**, then **EN** adaptation (not literal calque).
- Same `voiceProfile` for IT and EN (default `coral`).
- Shorts: burn-in captions **on** by default; soft SRT always.
- Full: soft SRT always; burn-in **off** by default.
- Two YouTube uploads per piece (IT + EN); Shorts use `contentKind: "short"`; full uses `contentKind: "full"` (no `#Shorts`).
- Focus car copy: white/black/green π / S.Marcato 42; never invent race facts beyond `racePackage` / candidate metadata.
- Conventional Commits; log start/step/end + durations; no secrets in logs.
- Hexagonal: domain free of FFmpeg/OpenAI imports; adapters at edges.
- Keep existing non-VO approve→render→publish working unless VO flag is set.

## File map

| Path | Responsibility |
|------|----------------|
| `src/domain/voice-over.ts` | Pure types + SRT/ASS builders + script hash |
| `src/ports/tts.ts` | Add optional `instructions` |
| `src/ports/transcription.ts` | Word-level segment option |
| `src/ports/youtube-captions.ts` | Upload soft captions |
| `src/adapters/tts/openai-compatible-tts.ts` | Pass `instructions` when set |
| `src/adapters/transcription/openai-compatible-whisper.ts` | `timestamp_granularities[]=word` |
| `src/adapters/captions/youtube-captions.ts` | Captions API insert |
| `src/adapters/ffmpeg/ffmpeg-render.ts` | Duck VO + ASS burn-in for replay/clip |
| `src/adapters/ffmpeg/ffmpeg-full-vo-mix.ts` | Mix VO onto full delivery encode |
| `src/application/generate-short-voice-overs.ts` | Script→TTS→align→paths for one candidate |
| `src/application/render-vo-short.ts` | Render one language Short with mix+burn-in |
| `src/application/publish-vo-short-pair.ts` | Enqueue dual publish + captions |
| `src/application/generate-full-voice-overs.ts` | Full narration IT/EN + mix |
| `src/application/request-full-replay-publish.ts` | Extend for VO IT+EN mode |
| `src/domain/entities.ts` | `VoiceOverPackage`, candidate/session fields |
| `src/ports/settings-repository.ts` | Voice + burn-in + duck settings |
| `src/workers/*` | Jobs: `generate_vo_short`, `render_vo_short`, `publish_vo_short` |
| `app/candidates/*`, `app/replays/page.tsx`, `app/settings/*` | UI |
| `tests/**` | Unit + smoke for SRT/ASS, align parse, VO use cases |

---

### Task 1: Domain caption writers + VoiceOver types

**Files:**
- Create: `src/domain/voice-over.ts`
- Modify: `src/domain/entities.ts`
- Test: `tests/domain/voice-over.test.ts`

**Interfaces:**
- Produces: `VoiceOverLanguage`, `TimedWord`, `VoiceOverPackage`, `buildSrt(words)`, `buildAssKaraoke(words)`, `hashVoiceScript(script, voice, lang)`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { buildAssKaraoke, buildSrt, hashVoiceScript } from "@/src/domain/voice-over";

describe("voice-over captions", () => {
  const words = [
    { text: "Sorpasso", startMs: 0, endMs: 400 },
    { text: "pulito", startMs: 400, endMs: 900 },
  ];

  it("builds SRT with word-grouped cues", () => {
    const srt = buildSrt(words);
    expect(srt).toContain("00:00:00,000 --> 00:00:00,900");
    expect(srt).toContain("Sorpasso pulito");
  });

  it("builds ASS with per-word timing tags", () => {
    const ass = buildAssKaraoke(words);
    expect(ass).toContain("[Events]");
    expect(ass).toMatch(/\{\\k\d+\}/);
  });

  it("hashes script+voice+lang stably", () => {
    expect(hashVoiceScript("ciao", "coral", "it")).toBe(
      hashVoiceScript("ciao", "coral", "it"),
    );
    expect(hashVoiceScript("ciao", "coral", "it")).not.toBe(
      hashVoiceScript("ciao", "coral", "en"),
    );
  });
});
```

- [ ] **Step 2: Run test — expect FAIL** (module missing)

Run: `npm test -- tests/domain/voice-over.test.ts`

- [ ] **Step 3: Implement `src/domain/voice-over.ts`**

```typescript
import { createHash } from "node:crypto";

export type VoiceOverLanguage = "it" | "en";

export type TimedWord = {
  text: string;
  startMs: number;
  endMs: number;
};

export type VoiceOverPackage = {
  language: VoiceOverLanguage;
  script: string;
  voiceProfile: string;
  audioPath: string;
  words: TimedWord[];
  srtPath: string | null;
  assPath: string | null;
  scriptHash: string;
};

export function hashVoiceScript(
  script: string,
  voiceProfile: string,
  language: VoiceOverLanguage,
): string {
  return createHash("sha256")
    .update(`${language}\n${voiceProfile}\n${script.trim()}`)
    .digest("hex")
    .slice(0, 16);
}

function srtStamp(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  const milli = ms % 1_000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

/** Group words into ~1 line cues (max ~42 chars or 1.5s gap). */
export function buildSrt(words: TimedWord[]): string {
  if (!words.length) return "";
  const cues: Array<{ startMs: number; endMs: number; text: string }> = [];
  let buf: TimedWord[] = [];
  const flush = () => {
    if (!buf.length) return;
    cues.push({
      startMs: buf[0]!.startMs,
      endMs: buf[buf.length - 1]!.endMs,
      text: buf.map((w) => w.text).join(" "),
    });
    buf = [];
  };
  for (const word of words) {
    const nextLen =
      buf.reduce((n, w) => n + w.text.length + 1, 0) + word.text.length;
    const gap =
      buf.length > 0 ? word.startMs - buf[buf.length - 1]!.endMs : 0;
    if (buf.length && (nextLen > 42 || gap > 1_500)) flush();
    buf.push(word);
  }
  flush();
  return cues
    .map(
      (cue, i) =>
        `${i + 1}\n${srtStamp(cue.startMs)} --> ${srtStamp(cue.endMs)}\n${cue.text}\n`,
    )
    .join("\n");
}

export function buildAssKaraoke(words: TimedWord[]): string {
  const header = `[Script Info]
Title: S.Marcato VO
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,72,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,0,2,60,60,220,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  if (!words.length) return header;
  const start = words[0]!.startMs;
  const end = words[words.length - 1]!.endMs;
  const assTime = (ms: number) => {
    const cs = Math.floor(ms / 10);
    const h = Math.floor(cs / 360_000);
    const m = Math.floor((cs % 360_000) / 6_000);
    const s = Math.floor((cs % 6_000) / 100);
    const c = cs % 100;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
  };
  let text = "";
  let cursor = start;
  for (const word of words) {
    const gapCs = Math.max(0, Math.round((word.startMs - cursor) / 10));
    if (gapCs > 0) text += `{\\k${gapCs}}`;
    const durCs = Math.max(1, Math.round((word.endMs - word.startMs) / 10));
    text += `{\\k${durCs}}${word.text} `;
    cursor = word.endMs;
  }
  return `${header}Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${text.trim()}\n`;
}
```

Also add to `entities.ts` (near ShortCandidate):

```typescript
import type { VoiceOverPackage } from "./voice-over";
// on ShortCandidate:
voiceOvers?: VoiceOverPackage[] | null;
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- tests/domain/voice-over.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/domain/voice-over.ts src/domain/entities.ts tests/domain/voice-over.test.ts
git commit -m "feat(domain): VO types and SRT/ASS caption builders"
```

---

### Task 2: TTS instructions + Whisper word timestamps

**Files:**
- Modify: `src/ports/tts.ts`, `src/adapters/tts/openai-compatible-tts.ts`
- Modify: `src/ports/transcription.ts`, `src/adapters/transcription/openai-compatible-whisper.ts`
- Test: `tests/adapters/tts-instructions.test.ts`, `tests/adapters/whisper-words.test.ts`

**Interfaces:**
- Consumes: existing TTS/Whisper adapters
- Produces: `TtsSynthesizeInput.instructions?: string`; `TranscriptionResult.words?: TimedWord[]`; `transcribe(path, { words?: boolean })`

- [ ] **Step 1: Failing tests** — assert fetch body includes `instructions` when set; Whisper parse maps `words: [{word,start,end}]` to ms.

- [ ] **Step 2: Implement** — TTS JSON adds `instructions` if present. Whisper form appends `timestamp_granularities[]=word` and `response_format=verbose_json`; map words into `TimedWord[]` (reuse domain type via ports or duplicate minimal shape in port to avoid adapter→domain cycle — prefer importing type-only from domain as other ports already do entities).

Default brand instructions constant in `src/domain/voice-over.ts`:

```typescript
export const BRAND_TTS_INSTRUCTIONS =
  "Energetic simracing YouTube commentator for S.Marcato 42 Racing. Punchy, clear, inviting viewers to the channel. Not robotic.";
```

- [ ] **Step 3: Tests PASS + commit**

```bash
git commit -m "feat(adapters): TTS instructions and Whisper word timestamps"
```

---

### Task 3: Settings for voice + captions + duck

**Files:**
- Modify: `src/ports/settings-repository.ts`, `src/adapters/settings/file-settings.ts`, `src/application/settings.ts`, `src/lib/container.ts` defaults, `app/settings` UI if present
- Test: `tests/application/settings.test.ts`

**Produces settings fields:**

```typescript
brandVoiceProfile: string; // default "coral"
shortsBurnInCaptions: boolean; // default true
fullBurnInCaptions: boolean; // default false
voiceDuckDb: number; // default -12
enableVoiceOverPipeline: boolean; // default true once shipped, or false for opt-in first — use true with VO triggered explicitly from UI
```

- [ ] **Step 1–4:** Extend schema merge in `file-settings.ts`, update settings tests, wire Settings UI selects for voice (`coral|verse|alloy|echo|fable|onyx|nova|shimmer` documented).

- [ ] **Step 5: Commit** `chore(settings): brand voice and caption burn-in flags`

---

### Task 4: Generate Short VO packages (script → TTS → align)

**Files:**
- Create: `src/application/generate-short-voice-overs.ts`
- Modify: `src/lib/container.ts`, media-store paths `voPath(candidateId, lang)`
- Test: `tests/application/generate-short-voice-overs.test.ts`

**Interfaces:**
- Consumes: `LlmPort`, `TtsPort`, `TranscriptionPort`, `MediaStorePort`, settings
- Produces: `GenerateShortVoiceOvers({ candidateId }) => VoiceOverPackage[]` (it+en), persists on candidate

- [ ] **Step 1: Failing test** with fake LLM returning `{ scriptIt, scriptEn, titleIt, titleEn, descriptionIt, descriptionEn }`, fake TTS writing empty files, fake transcription returning words.

- [ ] **Step 2: Implement use case**
  - LLM system: Italian primary Short VO 8–25s + English adaptation; CTA; focus car rules from spec.
  - Cache: if `scriptHash` matches existing package on candidate, skip TTS/align.
  - Write SRT via `buildSrt` to `mediaStore` path; store ASS path for render.
  - Logging: per-language durations.

- [ ] **Step 3: Tests PASS + commit** `feat(vo): generate bilingual Short voice-over packages`

---

### Task 5: FFmpeg Short render with VO duck + ASS burn-in

**Files:**
- Modify: `src/ports/render.ts`, `src/adapters/ffmpeg/ffmpeg-render.ts`, `src/workers/render-short-handler.ts`
- Create: `src/application/render-vo-short.ts` (or extend handler payload with `language`)
- Test: `tests/adapters/ffmpeg-vo-burnin.test.ts` (mock spawn; assert filter contains `ass=` and `sidechaincompress` or `volume=` duck)

**Approach:**
- New render mode for VO Shorts: inputs = source window + VO mp3 + ASS file.
- Filter: scale/crop brand as today; `[0:a]volume=0.25[ga];[1:a]volume=1[va];[ga][va]amix=inputs=2:duration=first:dropout_transition=0[aout]` (map `voiceDuckDb` to linear volume ≈ `10^(db/20)`).
- Subtitles: `ass=filename` on video (escape Windows paths: `C\:/path/file.ass`).
- Output still 1080x1920.

- [ ] **Step 1–4:** TDD mock spawn; wire `burnInCaptions` + `voiceAssetPath` + `assPath` on `RenderInput`.

- [ ] **Step 5: Commit** `feat(render): duck game audio under VO and burn-in ASS`

---

### Task 6: Dual Short publish + YouTube captions

**Files:**
- Create: `src/ports/youtube-captions.ts`, `src/adapters/youtube/youtube-captions.ts`
- Create: `src/application/publish-vo-short-pair.ts`
- Modify: `src/workers/publish-short-handler.ts` (accept `language`, `srtPath`, localized title/desc; upload captions after video insert)
- Modify: `src/domain/queue-control.ts` steps if new job type `publish_vo_short`
- Test: `tests/application/publish-vo-short-pair.test.ts`

**Flow:**
1. After both language renders exist, enqueue two `publish_short` (or `publish_vo_short`) jobs with metadata per language.
2. After `videos.insert`, call `captions.insert` with SRT (`language=it` / `en`, `name=VO`).
3. Store sibling youtube ids on candidate if useful (`voiceOverYoutubeIds?: { it?: string; en?: string }`).

OAuth scope: ensure `youtube.force-ssl` or captions scope is included in `src/adapters/youtube/oauth.ts` (`https://www.googleapis.com/auth/youtube.force-ssl` already covers captions if upload scope set — verify and add `youtube.force-ssl` if missing).

- [ ] **Step 1–5:** TDD enqueue pair; captions adapter unit test with mocked fetch; commit `feat(publish): dual IT/EN Short upload with SRT captions`

---

### Task 7: Full-race VO generate + mix + dual upload

**Files:**
- Create: `src/adapters/ffmpeg/ffmpeg-full-vo-mix.ts`, `src/ports/full-vo-mix.ts`
- Create: `src/application/generate-full-voice-overs.ts`
- Modify: `src/application/request-full-replay-publish.ts`, `src/workers/publish-full-replay-handler.ts`
- Test: `tests/application/generate-full-voice-overs.test.ts`

**Flow:**
1. Require `racePackage` + existing `fullVideoEncodePath` (or encode first).
2. LLM chaptered IT/EN scripts from timeline; chunk TTS (~500–800 words max per call); concat mp3 with FFmpeg.
3. Align each chunk or final concat with Whisper words; build SRT (no ASS burn-in by default).
4. Mix VO onto delivery MP4 → `full-youtube-it.mp4` / `full-youtube-en.mp4`.
5. Upload both with `contentKind: "full"` + captions; privacy from UI (default unlisted).

- [ ] **Step 1–5:** TDD with fakes; commit `feat(replay): bilingual full-race VO mix and dual upload`

---

### Task 8: UI wiring

**Files:**
- Modify: `app/candidates/[id]/page.tsx` / `ReviewPanel` — button “Generate VO IT+EN”; show package status; approve still required before publish pair.
- Modify: `app/replays/page.tsx` — “Encode + upload full IT+EN VO” checkbox/button.
- Modify: settings page for voice profile + burn-in toggles.
- Test: light component/action tests if pattern exists; else manual checklist in PR.

- [ ] **Step 1:** Wire server actions → `generateShortVoiceOvers` / `publishVoShortPair` / full VO publish.
- [ ] **Step 2:** Smoke in browser on existing Oschersleben session + one Short candidate.
- [ ] **Step 3: Commit** `feat(ui): bilingual VO controls on candidates and replays`

---

### Task 9: End-to-end verification on real session

- [ ] Generate VO for one proposed Short from session `3ba5532d-3812-4868-82e7-9053c90bbf12`.
- [ ] Confirm ASS burn-in visible in render; SRT on disk; IT+EN uploads unlisted.
- [ ] Generate full VO variants from existing `full-youtube.mp4`; upload IT+EN unlisted (or skip EN public).
- [ ] Document operator steps in README short section (optional one paragraph).

---

## Spec coverage check

| Spec item | Task |
|-----------|------|
| IT+EN scripts, same voice | 3, 4, 7 |
| Whisper word sync | 2, 4 |
| Shorts burn-in + SRT | 1, 5, 6 |
| Full soft SRT, burn-in off | 7 |
| Dual uploads | 6, 7 |
| Settings voice/duck/burn-in | 3, 8 |
| Opt-in beside non-VO path | 4–8 (explicit VO actions) |
| Logging/cache | 4, 7 |
| Swappable TTS | ports unchanged shape + instructions |

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-12-bilingual-vo-captions.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with checkpoints  

Which approach?
