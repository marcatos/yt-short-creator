import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGenerateShortVoiceOvers } from "@/src/application/generate-short-voice-overs";
import type { ShortCandidate } from "@/src/domain/entities";
import {
  BRAND_TTS_INSTRUCTIONS,
  hashVoiceScript,
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
          return { durationMs: 4_000 };
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

    expect(systemPrompt).toMatch(
      /Italian first[\s\S]*English adaptation[\s\S]*CTA[\s\S]*white\/black\/green π[\s\S]*S\.Marcato 42/,
    );
    expect(synthesized.map(({ text }) => text)).toEqual([
      expect.stringContaining("Ultimo giro"),
      expect.stringContaining("Final lap"),
    ]);
    expect(
      synthesized.every(
        ({ voiceProfile, instructions }) =>
          voiceProfile === "coral" && instructions === BRAND_TTS_INSTRUCTIONS,
      ),
    ).toBe(true);
    expect(transcribed).toEqual([
      { path: expect.stringContaining("vo-it.mp3"), words: true },
      { path: expect.stringContaining("vo-en.mp3"), words: true },
    ]);
    expect(result.map(({ language }) => language)).toEqual(["it", "en"]);
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
      voiceProfile: "coral",
      audioPath: "cached-it.mp3",
      words: [],
      srtPath: "cached-it.srt",
      assPath: "cached-it.ass",
      scriptHash: hashVoiceScript(scriptIt, "coral", "it"),
    };
    const synthesized: string[] = [];
    const generate = createGenerateShortVoiceOvers({
      llm: { complete: async () => JSON.stringify(llmResponse) },
      tts: {
        synthesize: async ({ outputPath }) => {
          synthesized.push(outputPath);
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, "");
          return { durationMs: 1_000 };
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

    expect(result[0]).toBe(cached);
    expect(synthesized).toEqual([expect.stringContaining("vo-en.mp3")]);
  });
});
