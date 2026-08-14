import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  candidateContext,
  createGenerateShortVoiceOvers,
} from "@/src/application/generate-short-voice-overs";
import type { ShortCandidate } from "@/src/domain/entities";
import type { RaceAnalysis } from "@/src/domain/race-analysis";
import {
  hashVoiceScript,
  ttsInstructionsFor,
  type VoiceOverPackage,
} from "@/src/domain/voice-over";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { Logger } from "@/src/ports/logger";
import type { AppSettings } from "@/src/ports/settings-repository";

const tempDirs: string[] = [];
const now = new Date("2026-08-12T10:00:00.000Z");

class MemoryCandidates implements CandidateRepository {
  constructor(public candidate: ShortCandidate) {}
  async save(candidate: ShortCandidate) {
    this.candidate = candidate;
  }
  async getById(id: string) {
    return this.candidate.id === id ? this.candidate : null;
  }
  async listByIds(ids: string[]) {
    return ids.includes(this.candidate.id) ? [this.candidate] : [];
  }
  async list() {
    return [this.candidate];
  }
}

function candidate(voiceOvers: VoiceOverPackage[] | null = null): ShortCandidate {
  return {
    id: "candidate-42",
    origin: "replay",
    status: "approved",
    title: "Sorpasso all'ultimo giro",
    description: "La pi car trova il varco decisivo.",
    tags: ["simracing"],
    score: 0.96,
    provenance: {
      replaySessionId: "replay-1",
      startMs: 10_000,
      endMs: 28_000,
      hookReason: "Late braking pass by the focus car",
      eventType: "overtake",
      crop: { mode: "center_vertical", focusX: 0.5 },
    },
    renderOutputPath: null,
    voiceOvers,
    scheduledAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function settings(): AppSettings {
  return {
    brandRoot: "brand",
    logLevel: "INFO",
    defaultPrivacy: "public",
    videoEncoderPreference: "auto_igpu",
    brandVoiceProfile: "coral",
    italianVoiceProfile: "ash",
    shortsBurnInCaptions: true,
    fullBurnInCaptions: false,
    voiceDuckDb: -12,
    enableVoiceOverPipeline: true,
  };
}

function logger(): Logger {
  const instance: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child: () => instance,
  };
  return instance;
}

async function store() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "short-vo-"));
  tempDirs.push(root);
  return {
    sourcePath: () => "",
    renderPath: () => "",
    audioPath: () => "",
    voPath: (candidateId: string, language: "it" | "en") =>
      path.join(root, candidateId, `vo-${language}.mp3`),
    writeText: async (filePath: string, content: string) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
    },
    brollPath: () => "",
    replayAnalysisDir: () => "",
    fullReplayEncodePath: () => "",
    listBroll: async () => [],
    ensureDirs: async () => {},
  };
}

const llmResponse = {
  scriptIt:
    "Ultimo giro, staccata perfetta della pi! Segui S.Marcato 42 per la gara completa.",
  scriptEn:
    "Final lap, the pi car sends it! Follow S.Marcato 42 for the full race.",
  titleIt: "Sorpasso decisivo",
  titleEn: "The decisive pass",
  descriptionIt: "Il momento chiave della gara.",
  descriptionEn: "The race-defining moment.",
};

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("generateShortVoiceOvers", () => {
  it("generates, aligns, writes captions, and persists Italian before English", async () => {
    const candidates = new MemoryCandidates(candidate());
    const synthesized: Array<Record<string, unknown>> = [];
    const transcribed: Array<{ path: string; words?: boolean }> = [];
    let systemPrompt = "";
    const generate = createGenerateShortVoiceOvers({
      llm: {
        complete: async (input) => {
          systemPrompt = input.system;
          return JSON.stringify(llmResponse);
        },
      },
      tts: {
        synthesize: async (input) => {
          synthesized.push(input);
          await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
          await fs.writeFile(input.outputPath, "");
          return { durationMs: 10_000 };
        },
      },
      transcription: {
        transcribe: async (audioPath, options) => {
          transcribed.push({ path: audioPath, words: options?.words });
          return {
            text: "two words",
            segments: [],
            language: null,
            words: [
              { text: "two", startMs: 0, endMs: 300 },
              { text: "words", startMs: 350, endMs: 800 },
            ],
          };
        },
      },
      mediaStore: await store(),
      candidates,
      settings: { get: async () => settings(), save: async () => {} },
      logger: logger(),
    });

    const result = await generate({ candidateId: "candidate-42" });

    expect(systemPrompt).toMatch(/first person/i);
    expect(systemPrompt).toMatch(/Italian first/i);
    expect(systemPrompt).toMatch(/Simone Marcato/);
    expect(systemPrompt).toMatch(/not a brand name|Do NOT treat/i);
    expect(systemPrompt).toMatch(/8–25 spoken seconds/);
    expect(systemPrompt).toMatch(/Do not speak chapter timestamps/i);
    expect(synthesized.map(({ text }) => text)).toEqual([
      expect.stringContaining("Ultimo giro"),
      expect.stringContaining("Final lap"),
    ]);
    expect(
      synthesized.map(({ voiceProfile, instructions }) => ({
        voiceProfile,
        instructions,
      })),
    ).toEqual([
      { voiceProfile: "ash", instructions: ttsInstructionsFor("it") },
      { voiceProfile: "coral", instructions: ttsInstructionsFor("en") },
    ]);
    expect(transcribed).toEqual([
      { path: expect.stringContaining("vo-it.mp3"), words: true },
      { path: expect.stringContaining("vo-en.mp3"), words: true },
    ]);
    expect(result.map(({ language }) => language)).toEqual(["it", "en"]);
    expect(
      result.map(({ language, title, description }) => ({
        language,
        title,
        description,
      })),
    ).toEqual([
      {
        language: "it",
        title: llmResponse.titleIt,
        description: llmResponse.descriptionIt,
      },
      {
        language: "en",
        title: llmResponse.titleEn,
        description: llmResponse.descriptionEn,
      },
    ]);
    expect(candidates.candidate.voiceOvers).toEqual(result);
    for (const voiceOver of result) {
      expect(await fs.readFile(voiceOver.srtPath!, "utf8")).toContain("two words");
      expect(await fs.readFile(voiceOver.assPath!, "utf8")).toContain("{\\k30}two");
    }
  });

  it("reuses a package when its language script hash matches", async () => {
    const scriptIt = llmResponse.scriptIt;
    const cached: VoiceOverPackage = {
      language: "it",
      script: scriptIt,
      title: "Cached title",
      description: "Cached description",
      voiceProfile: "ash",
      audioPath: "cached-it.mp3",
      words: [],
      srtPath: "cached-it.srt",
      assPath: "cached-it.ass",
      scriptHash: hashVoiceScript(scriptIt, "ash", "it"),
    };
    const synthesized: string[] = [];
    const generate = createGenerateShortVoiceOvers({
      llm: { complete: async () => JSON.stringify(llmResponse) },
      tts: {
        synthesize: async ({ outputPath }) => {
          synthesized.push(outputPath);
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, "");
          return { durationMs: 10_000 };
        },
      },
      transcription: {
        transcribe: async () => ({
          text: "new",
          segments: [],
          language: "en",
          words: [{ text: "new", startMs: 0, endMs: 500 }],
        }),
      },
      mediaStore: await store(),
      candidates: new MemoryCandidates(candidate([cached])),
      settings: { get: async () => settings(), save: async () => {} },
      logger: logger(),
    });

    const result = await generate({ candidateId: "candidate-42" });

    expect(result[0]).toEqual({
      ...cached,
      title: llmResponse.titleIt,
      description: llmResponse.descriptionIt,
    });
    expect(synthesized).toEqual([expect.stringContaining("vo-en.mp3")]);
  });

  it.each([
    { durationMs: 7_999, valid: false },
    { durationMs: 8_000, valid: true },
    { durationMs: 25_000, valid: true },
    { durationMs: 25_001, valid: false },
  ])(
    "validates the inclusive 8–25 second range ($durationMs ms)",
    async ({ durationMs, valid }) => {
      const candidates = new MemoryCandidates(candidate());
      let transcriptionCalls = 0;
      const generate = createGenerateShortVoiceOvers({
        llm: { complete: async () => JSON.stringify(llmResponse) },
        tts: { synthesize: async () => ({ durationMs }) },
        transcription: {
          transcribe: async () => {
            transcriptionCalls += 1;
            return {
              text: "valid",
              segments: [],
              language: null,
              words: [{ text: "valid", startMs: 0, endMs: 500 }],
            };
          },
        },
        mediaStore: await store(),
        candidates,
        settings: { get: async () => settings(), save: async () => {} },
        logger: logger(),
      });

      if (valid) {
        await expect(
          generate({ candidateId: "candidate-42" }),
        ).resolves.toHaveLength(2);
        expect(transcriptionCalls).toBe(2);
      } else {
        await expect(generate({ candidateId: "candidate-42" })).rejects.toThrow(
          /duration.*8,000.*25,000/i,
        );
        expect(transcriptionCalls).toBe(0);
        expect(candidates.candidate.voiceOvers).toBeNull();
      }
    },
  );

  it("rejects a narration the probe measures outside the range", async () => {
    const candidates = new MemoryCandidates(candidate());
    const probed: string[] = [];
    const generate = createGenerateShortVoiceOvers({
      llm: { complete: async () => JSON.stringify(llmResponse) },
      // The adapter estimate clears the gate; only the rendered file is long.
      tts: { synthesize: async () => ({ durationMs: 10_000 }) },
      transcription: {
        transcribe: async () => ({
          text: "valid",
          segments: [],
          language: null,
          words: [{ text: "valid", startMs: 0, endMs: 500 }],
        }),
      },
      mediaDuration: {
        probeDurationSec: async (mediaPath) => {
          probed.push(mediaPath);
          return 31.4;
        },
      },
      mediaStore: await store(),
      candidates,
      settings: { get: async () => settings(), save: async () => {} },
      logger: logger(),
    });

    await expect(generate({ candidateId: "candidate-42" })).rejects.toThrow(
      /received 31,?400 ms/,
    );
    expect(probed).toEqual([expect.stringContaining("vo-it.mp3")]);
    expect(candidates.candidate.voiceOvers).toBeNull();
  });

  it("falls back to the synthesis estimate when the probe fails", async () => {
    const candidates = new MemoryCandidates(candidate());
    const generate = createGenerateShortVoiceOvers({
      llm: { complete: async () => JSON.stringify(llmResponse) },
      tts: {
        synthesize: async ({ outputPath }) => {
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, "");
          return { durationMs: 10_000 };
        },
      },
      transcription: {
        transcribe: async () => ({
          text: "valid",
          segments: [],
          language: null,
          words: [{ text: "valid", startMs: 0, endMs: 500 }],
        }),
      },
      mediaDuration: {
        probeDurationSec: async () => {
          throw new Error("ffprobe missing");
        },
      },
      mediaStore: await store(),
      candidates,
      settings: { get: async () => settings(), save: async () => {} },
      logger: logger(),
    });

    await expect(generate({ candidateId: "candidate-42" })).resolves.toHaveLength(
      2,
    );
  });

  it.each([undefined, []])(
    "rejects alignment without word timestamps (%s)",
    async (words) => {
      const candidates = new MemoryCandidates(candidate());
      const generate = createGenerateShortVoiceOvers({
        llm: { complete: async () => JSON.stringify(llmResponse) },
        tts: { synthesize: async () => ({ durationMs: 10_000 }) },
        transcription: {
          transcribe: async () => ({
            text: "aligned text",
            segments: [],
            language: null,
            words,
          }),
        },
        mediaStore: await store(),
        candidates,
        settings: { get: async () => settings(), save: async () => {} },
        logger: logger(),
      });

      await expect(generate({ candidateId: "candidate-42" })).rejects.toThrow(
        /word timestamps/i,
      );
      expect(candidates.candidate.voiceOvers).toBeNull();
    },
  );

  it("merges voice-overs onto a freshly loaded candidate before saving", async () => {
    const initial = candidate();
    const concurrentlyUpdated = {
      ...initial,
      title: "Title updated while VO generated",
      description: "Concurrent description",
      tags: ["simracing", "concurrent"],
    };
    let getCalls = 0;
    let saved: ShortCandidate | null = null;
    const candidates: CandidateRepository = {
      getById: async () => {
        getCalls += 1;
        return getCalls === 1 ? initial : concurrentlyUpdated;
      },
      save: async (value) => {
        saved = value;
      },
      listByIds: async () => [],
      list: async () => [],
    };
    const generate = createGenerateShortVoiceOvers({
      llm: { complete: async () => JSON.stringify(llmResponse) },
      tts: { synthesize: async () => ({ durationMs: 10_000 }) },
      transcription: {
        transcribe: async () => ({
          text: "one",
          segments: [],
          language: null,
          words: [{ text: "one", startMs: 0, endMs: 500 }],
        }),
      },
      mediaStore: await store(),
      candidates,
      settings: { get: async () => settings(), save: async () => {} },
      logger: logger(),
    });

    const voiceOvers = await generate({ candidateId: initial.id });

    expect(getCalls).toBe(2);
    expect(saved).toEqual({ ...concurrentlyUpdated, voiceOvers });
  });
});

describe("candidateContext HUD enrichment", () => {
  it("includes raceFacts and hudWindow from analysis", () => {
    const analysis: RaceAnalysis = {
      version: 1,
      focusCarHint: "#7 Simone Marcato (camera focus from HUD)",
      context: {
        simulator: "iRacing",
        track: "Oschersleben",
        car: null,
        durationSec: 600,
      },
      results: {
        qualiResult: null,
        startPosition: 5,
        finishPosition: 2,
        fieldSize: 19,
        positionsGained: 3,
      },
      recurringRivals: ["#4 Yoan"],
      events: [
        {
          kind: "battle",
          startMs: 12_000,
          endMs: 20_000,
          summary: "Close battle",
          involvingFocusCar: true,
          confidence: "verified",
        },
      ],
      timeline: [],
      storylines: [
        {
          kind: "main",
          summary: "Battle for P2",
          whyWatch: "Close fight",
        },
      ],
      mainStoryline: "Battle",
      whyWatch: "Close fight",
      potentialHooks: ["P2 battle"],
      shortCandidates: [
        {
          shortScore: 0.9,
          startMs: 10_000,
          endMs: 28_000,
          hook: "h",
          story: "s",
          payoff: "p",
          recommendedTitleIt: "IT",
          recommendedTitleEn: "EN",
          requiresLocalizedRender: false,
          tags: [],
          descriptionIt: "d",
          descriptionEn: "d",
        },
      ],
      narrativeIt: "Battaglia.",
      audioTranscript: "",
      hudTimeline: [
        {
          timeMs: 12_000,
          session: {
            sessionType: "RACE",
            status: "REPLAY",
            trackName: "Oschersleben",
            lap: 2,
            sessionTime: "7:28",
            flag: "GREEN",
          },
          focus: {
            carNumber: 7,
            driverName: "Simone Marcato",
            position: 2,
            fieldSize: 19,
            lastLap: "1:41.143",
            bestLap: null,
            gapToLeader: "+0.86s",
          },
          battle: {
            rows: [
              {
                role: "ahead",
                carNumber: 4,
                driverName: "Yoan",
                gapSec: -0.86,
              },
              {
                role: "focus",
                carNumber: 7,
                driverName: "Simone Marcato",
                gapSec: 0,
              },
              {
                role: "behind",
                carNumber: 5,
                driverName: "Kike",
                gapSec: 0.06,
              },
            ],
          },
          standings: {
            rows: [
              {
                position: 2,
                carNumber: 7,
                driverName: "Simone Marcato",
                gapText: "+0.86s",
              },
            ],
          },
          confidence: "verified",
        },
      ],
    };

    const ctx = JSON.parse(candidateContext(candidate(), analysis));
    expect(ctx.raceFacts.results.finishPosition).toBe(2);
    expect(ctx.raceFacts.eventsInWindow[0].kind).toBe("battle");
    expect(ctx.hudWindow.focus.carNumber).toBe(7);
    expect(ctx.hudWindow.lastFocus.gapToLeader).toBe("+0.86s");
  });
});
