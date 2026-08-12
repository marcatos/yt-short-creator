import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGenerateFullVoiceOvers } from "@/src/application/generate-full-voice-overs";
import type { ReplaySession } from "@/src/domain/entities";
import {
  BRAND_TTS_INSTRUCTIONS,
  hashVoiceScript,
  type VoiceOverPackage,
} from "@/src/domain/voice-over";
import type { AudioConcatInput } from "@/src/ports/full-vo-mix";
import type { Logger } from "@/src/ports/logger";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";
import type { AppSettings } from "@/src/ports/settings-repository";
import type { TtsSynthesizeInput } from "@/src/ports/tts";

const tempDirs: string[] = [];
const now = new Date("2026-08-12T20:00:00.000Z");

class MemorySessions implements ReplaySessionRepository {
  constructor(public session: ReplaySession) {}
  async save(session: ReplaySession) {
    this.session = session;
  }
  async getById(id: string) {
    return this.session.id === id ? this.session : null;
  }
  async list() {
    return [this.session];
  }
}

function session(overrides: Partial<ReplaySession> = {}): ReplaySession {
  return {
    id: "session-7",
    rpyPath: null,
    ibtPath: null,
    mediaPath: "C:/Videos/race.mkv",
    trackName: "Oschersleben",
    focusCarIdx: 42,
    title: "Endurance race",
    durationSec: 2_400,
    status: "ready",
    events: [],
    racePackage: {
      focusCarHint: "pi",
      transcript: "Gara combattuta fino all'ultimo giro.",
      timeline: [
        {
          startMs: 0,
          endMs: 120_000,
          summary: "Partenza aggressiva",
          involvingFocusCar: true,
        },
        {
          startMs: 600_000,
          endMs: 720_000,
          summary: "Doppio sorpasso in staccata",
          involvingFocusCar: true,
        },
      ],
      fullVideo: {
        title: "Gara completa",
        description: "Descrizione",
        tags: ["iRacing", "simracing"],
      },
      audioTranscript: "",
    },
    fullVideoEncodePath: "media/replays/session-7/full-youtube.mp4",
    fullVideoYoutubeId: null,
    fullVideoPrivacy: null,
    fullVideoPublishedAt: null,
    fullVoiceOvers: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    brandRoot: "brand",
    logLevel: "INFO",
    defaultPrivacy: "unlisted",
    videoEncoderPreference: "auto_igpu",
    brandVoiceProfile: "coral",
    shortsBurnInCaptions: true,
    fullBurnInCaptions: false,
    voiceDuckDb: -12,
    enableVoiceOverPipeline: true,
    ...overrides,
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "full-vo-"));
  tempDirs.push(root);
  return {
    sourcePath: () => "",
    renderPath: () => "",
    audioPath: () => "",
    brollPath: () => "",
    replayAnalysisDir: (sessionId: string) => path.join(root, sessionId),
    fullReplayEncodePath: (sessionId: string) =>
      path.join(root, sessionId, "full-youtube.mp4"),
    fullReplayVoPath: (sessionId: string, language: "it" | "en") =>
      path.join(root, sessionId, `vo-${language}.mp3`),
    fullReplayVoRenderPath: (sessionId: string, language: "it" | "en") =>
      path.join(root, sessionId, `full-youtube-${language}.mp4`),
    writeText: async (filePath: string, content: string) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
    },
    listBroll: async () => [],
    ensureDirs: async () => {},
  };
}

/** ~600 words, so two chapters exceed the per-call TTS budget. */
function longChapterScript(marker: string): string {
  return Array.from(
    { length: 100 },
    (_, index) => `${marker} frase numero ${index} del capitolo.`,
  ).join(" ");
}

const chapters = [
  {
    label: "Partenza",
    scriptIt: longChapterScript("Partenza"),
    scriptEn: longChapterScript("Start"),
  },
  {
    label: "Sorpasso",
    scriptIt: longChapterScript("Sorpasso"),
    scriptEn: longChapterScript("Overtake"),
  },
];

const llmResponse = {
  chapters,
  titleIt: "Gara completa a Oschersleben",
  titleEn: "Full race at Oschersleben",
  descriptionIt: "Racconto completo della gara.",
  descriptionEn: "Full race narration.",
};

function fakeTts(synthesized: TtsSynthesizeInput[], durationMs = 60_000) {
  return {
    synthesize: async (input: TtsSynthesizeInput) => {
      synthesized.push(input);
      await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
      await fs.writeFile(input.outputPath, "");
      return { durationMs };
    },
  };
}

function fakeConcat(concatenated: AudioConcatInput[]) {
  return {
    concat: async (input: AudioConcatInput) => {
      concatenated.push(input);
      return { outputPath: input.outputPath, durationMs: 5 };
    },
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("generateFullVoiceOvers", () => {
  it("writes chaptered Italian first, chunks TTS, concatenates, and offsets word timings", async () => {
    const sessions = new MemorySessions(session());
    const synthesized: TtsSynthesizeInput[] = [];
    const concatenated: AudioConcatInput[] = [];
    const transcribed: Array<{ path: string; words?: boolean }> = [];
    let systemPrompt = "";
    let userPrompt = "";
    const generate = createGenerateFullVoiceOvers({
      llm: {
        complete: async (input) => {
          systemPrompt = input.system;
          userPrompt = input.user;
          return JSON.stringify(llmResponse);
        },
      },
      tts: fakeTts(synthesized),
      transcription: {
        transcribe: async (audioPath, options) => {
          transcribed.push({ path: audioPath, words: options?.words });
          return {
            text: "parte",
            segments: [],
            language: null,
            words: [
              { text: "parte", startMs: 0, endMs: 400 },
              { text: "due", startMs: 500, endMs: 900 },
            ],
          };
        },
      },
      audioConcat: fakeConcat(concatenated),
      mediaStore: await store(),
      replaySessions: sessions,
      settings: { get: async () => settings(), save: async () => {} },
      clock: { now: () => now },
      logger: logger(),
    });

    const result = await generate({ sessionId: "session-7" });

    expect(systemPrompt).toMatch(/Italian first[\s\S]*English adaptation/);
    expect(systemPrompt).toMatch(/chapter per timeline beat/i);
    expect(systemPrompt).toMatch(/white\/black\/green π[\s\S]*S\.Marcato 42/);
    expect(systemPrompt).toMatch(/Never invent race facts/i);
    expect(userPrompt).toContain("Doppio sorpasso in staccata");
    expect(result.map(({ language }) => language)).toEqual(["it", "en"]);

    // Two ~500-word chapters exceed one TTS call per language.
    expect(synthesized).toHaveLength(4);
    expect(synthesized.map(({ outputPath }) => path.basename(outputPath))).toEqual([
      "vo-it-part-1.mp3",
      "vo-it-part-2.mp3",
      "vo-en-part-1.mp3",
      "vo-en-part-2.mp3",
    ]);
    expect(
      synthesized.every(
        ({ voiceProfile, instructions }) =>
          voiceProfile === "coral" && instructions === BRAND_TTS_INSTRUCTIONS,
      ),
    ).toBe(true);
    expect(concatenated.map(({ inputPaths }) => inputPaths.length)).toEqual([2, 2]);
    expect(transcribed.every(({ words }) => words === true)).toBe(true);
    expect(transcribed.map(({ path: chunkPath }) => path.basename(chunkPath))).toEqual([
      "vo-it-part-1.mp3",
      "vo-it-part-2.mp3",
      "vo-en-part-1.mp3",
      "vo-en-part-2.mp3",
    ]);

    const italian = result[0]!;
    expect(italian.title).toBe(llmResponse.titleIt);
    expect(italian.description).toBe(llmResponse.descriptionIt);
    expect(italian.script).toContain(chapters[0]!.scriptIt);
    expect(italian.script).toContain(chapters[1]!.scriptIt);
    expect(path.basename(italian.audioPath)).toBe("vo-it.mp3");
    expect(italian.assPath).toBeNull();
    // Second chunk words shift by the first chunk's synthesized duration.
    expect(italian.words.map(({ startMs }) => startMs)).toEqual([
      0, 500, 60_000, 60_500,
    ]);
    expect(await fs.readFile(italian.srtPath!, "utf8")).toContain("parte due");
    expect(sessions.session.fullVoiceOvers).toEqual(result);
    expect(sessions.session.updatedAt).toEqual(now);
  });

  it("reuses a language package when the script hash still matches", async () => {
    const script = `${chapters[0]!.scriptIt}\n\n${chapters[1]!.scriptIt}`;
    const cached: VoiceOverPackage = {
      language: "it",
      script,
      title: "Vecchio titolo",
      description: "Vecchia descrizione",
      voiceProfile: "coral",
      audioPath: "cached-it.mp3",
      words: [{ text: "cache", startMs: 0, endMs: 100 }],
      srtPath: "cached-it.srt",
      assPath: null,
      scriptHash: hashVoiceScript(script, "coral", "it"),
      renderOutputPath: "cached-it.mp4",
      youtubeVideoId: "yt-cached-it",
      youtubeCaptionId: "caption-cached-it",
    };
    const synthesized: TtsSynthesizeInput[] = [];
    const sessions = new MemorySessions(session({ fullVoiceOvers: [cached] }));
    const generate = createGenerateFullVoiceOvers({
      llm: { complete: async () => JSON.stringify(llmResponse) },
      tts: fakeTts(synthesized),
      transcription: {
        transcribe: async () => ({
          text: "nuovo",
          segments: [],
          language: null,
          words: [{ text: "nuovo", startMs: 0, endMs: 400 }],
        }),
      },
      audioConcat: fakeConcat([]),
      mediaStore: await store(),
      replaySessions: sessions,
      settings: { get: async () => settings(), save: async () => {} },
      clock: { now: () => now },
      logger: logger(),
    });

    const result = await generate({ sessionId: "session-7" });

    expect(result[0]).toEqual({
      ...cached,
      title: llmResponse.titleIt,
      description: llmResponse.descriptionIt,
    });
    expect(
      synthesized.every(({ outputPath }) => outputPath.includes("vo-en")),
    ).toBe(true);
  });

  it("requires an analyzed race package", async () => {
    const sessions = new MemorySessions(session({ racePackage: null }));
    const generate = createGenerateFullVoiceOvers({
      llm: {
        complete: async () => {
          throw new Error("LLM must not be called");
        },
      },
      tts: fakeTts([]),
      transcription: {
        transcribe: async () => ({
          text: "",
          segments: [],
          language: null,
          words: [],
        }),
      },
      audioConcat: fakeConcat([]),
      mediaStore: await store(),
      replaySessions: sessions,
      settings: { get: async () => settings(), save: async () => {} },
      clock: { now: () => now },
      logger: logger(),
    });

    await expect(generate({ sessionId: "session-7" })).rejects.toThrow(
      /AV analysis|racePackage/i,
    );
    expect(sessions.session.fullVoiceOvers).toBeNull();
  });

  it("refuses to run while the voice-over pipeline is disabled", async () => {
    const sessions = new MemorySessions(session());
    const generate = createGenerateFullVoiceOvers({
      llm: {
        complete: async () => {
          throw new Error("LLM must not be called");
        },
      },
      tts: fakeTts([]),
      transcription: {
        transcribe: async () => ({
          text: "",
          segments: [],
          language: null,
          words: [],
        }),
      },
      audioConcat: fakeConcat([]),
      mediaStore: await store(),
      replaySessions: sessions,
      settings: {
        get: async () => settings({ enableVoiceOverPipeline: false }),
        save: async () => {},
      },
      clock: { now: () => now },
      logger: logger(),
    });

    await expect(generate({ sessionId: "session-7" })).rejects.toThrow(
      /disabled/i,
    );
  });

  it.each([undefined, []])(
    "rejects a chunk aligned without word timestamps (%s)",
    async (words) => {
      const sessions = new MemorySessions(session());
      const generate = createGenerateFullVoiceOvers({
        llm: { complete: async () => JSON.stringify(llmResponse) },
        tts: fakeTts([]),
        transcription: {
          transcribe: async () => ({
            text: "senza parole",
            segments: [],
            language: null,
            words,
          }),
        },
        audioConcat: fakeConcat([]),
        mediaStore: await store(),
        replaySessions: sessions,
        settings: { get: async () => settings(), save: async () => {} },
        clock: { now: () => now },
        logger: logger(),
      });

      await expect(generate({ sessionId: "session-7" })).rejects.toThrow(
        /word timestamps/i,
      );
      expect(sessions.session.fullVoiceOvers).toBeNull();
    },
  );

  it("merges packages onto a freshly loaded session before saving", async () => {
    const initial = session();
    const concurrentlyUpdated: ReplaySession = {
      ...initial,
      title: "Titolo cambiato durante la generazione",
      fullVideoYoutubeId: "yt-plain-upload",
    };
    let getCalls = 0;
    let saved: ReplaySession | null = null;
    const generate = createGenerateFullVoiceOvers({
      llm: { complete: async () => JSON.stringify(llmResponse) },
      tts: fakeTts([]),
      transcription: {
        transcribe: async () => ({
          text: "uno",
          segments: [],
          language: null,
          words: [{ text: "uno", startMs: 0, endMs: 400 }],
        }),
      },
      audioConcat: fakeConcat([]),
      mediaStore: await store(),
      replaySessions: {
        getById: async () => {
          getCalls += 1;
          return getCalls === 1 ? initial : concurrentlyUpdated;
        },
        save: async (value) => {
          saved = value;
        },
        list: async () => [],
      },
      settings: { get: async () => settings(), save: async () => {} },
      clock: { now: () => now },
      logger: logger(),
    });

    const packages = await generate({ sessionId: initial.id });

    expect(getCalls).toBe(2);
    expect(saved).toEqual({
      ...concurrentlyUpdated,
      fullVoiceOvers: packages,
      updatedAt: now,
    });
  });
});
