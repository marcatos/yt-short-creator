import { describe, expect, it } from "vitest";

import type { ReplaySession } from "@/src/domain/entities";
import type { JobCheckpoint } from "@/src/domain/queue-control";
import type { VoiceOverPackage } from "@/src/domain/voice-over";
import type { FullVoMixInput } from "@/src/ports/full-vo-mix";
import type { Logger } from "@/src/ports/logger";
import type { AppSettings } from "@/src/ports/settings-repository";
import type { YouTubeCaptionUploadInput } from "@/src/ports/youtube-captions";
import type { YouTubeUploadInput } from "@/src/ports/youtube-upload";
import type { JobHandlerContext } from "@/src/workers/job-handler-context";
import { createPublishFullReplayHandler } from "@/src/workers/publish-full-replay-handler";

const now = new Date("2026-08-12T21:00:00.000Z");

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

function voiceOver(
  language: "it" | "en",
  overrides: Partial<VoiceOverPackage> = {},
): VoiceOverPackage {
  return {
    language,
    script: `Script ${language}`,
    title: `Titolo ${language}`,
    description: `Descrizione ${language}`,
    voiceProfile: "coral",
    audioPath: `media/replays/session-1/vo-${language}.mp3`,
    words: [{ text: "via", startMs: 0, endMs: 200 }],
    srtPath: `media/replays/session-1/vo-${language}.srt`,
    assPath: null,
    scriptHash: `hash-${language}`,
    ...overrides,
  };
}

function session(overrides: Partial<ReplaySession> = {}): ReplaySession {
  return {
    id: "session-1",
    rpyPath: null,
    ibtPath: null,
    mediaPath: "C:/Videos/race.mkv",
    trackName: "Oschersleben",
    focusCarIdx: null,
    title: "Race",
    durationSec: 2_400,
    status: "ready",
    events: [],
    racePackage: {
      focusCarHint: "pi",
      transcript: "Gara",
      timeline: [],
      fullVideo: {
        title: "Titolo gara",
        description: "Desc",
        tags: ["iRacing", "simracing"],
      },
      audioTranscript: "",
    },
    fullVideoEncodePath: null,
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

type Harness = {
  handler: ReturnType<typeof createPublishFullReplayHandler>;
  store: { session: ReplaySession };
  mixed: FullVoMixInput[];
  uploaded: YouTubeUploadInput[];
  captioned: YouTubeCaptionUploadInput[];
  generateCalls: string[];
  checkpoints: Array<{ step: string; data?: unknown }>;
  sidecars: Map<string, string>;
};

function harness(options: {
  session?: ReplaySession;
  settings?: AppSettings;
  packages?: VoiceOverPackage[];
  withCaptions?: boolean;
  withVoiceOverDeps?: boolean;
  sidecars?: Map<string, string>;
} = {}): Harness {
  const store = { session: options.session ?? session() };
  const sidecars = options.sidecars ?? new Map<string, string>();
  const mixed: FullVoMixInput[] = [];
  const uploaded: YouTubeUploadInput[] = [];
  const captioned: YouTubeCaptionUploadInput[] = [];
  const generateCalls: string[] = [];
  const checkpoints: Array<{ step: string; data?: unknown }> = [];
  const packages = options.packages ?? [voiceOver("it"), voiceOver("en")];

  const voiceOverDeps = {
    generateFullVoiceOvers: async ({ sessionId }: { sessionId: string }) => {
      generateCalls.push(sessionId);
      const existing = store.session.fullVoiceOvers ?? [];
      const merged = packages.map(
        (item) =>
          existing.find((saved) => saved.language === item.language) ?? item,
      );
      store.session = { ...store.session, fullVoiceOvers: merged };
      return merged;
    },
    fullVoMix: {
      async mix(input: FullVoMixInput) {
        mixed.push(input);
        return {
          outputPath: input.outputPath,
          burnedInCaptions: Boolean(
            input.burnInCaptions && input.subtitlesPath,
          ),
          durationMs: 10,
        };
      },
    },
  };

  const handler = createPublishFullReplayHandler({
    logger: logger(),
    replaySessions: {
      async save(value) {
        store.session = value;
      },
      async getById(id) {
        return store.session.id === id ? store.session : null;
      },
      async list() {
        return [store.session];
      },
    },
    mediaStore: {
      sourcePath: () => "",
      renderPath: () => "",
      audioPath: () => "",
      brollPath: () => "",
      replayAnalysisDir: () => "media/replays/session-1",
      fullReplayEncodePath: () => "media/replays/session-1/full-youtube.mp4",
      fullReplayVoPath: (sessionId, language) =>
        `media/replays/${sessionId}/vo-${language}.mp3`,
      fullReplayVoRenderPath: (sessionId, language) =>
        `media/replays/${sessionId}/full-youtube-${language}.mp4`,
      fullVoPublishCheckpointPath: (sessionId, language) =>
        `media/replays/${sessionId}/vo-publish-${language}.json`,
      readText: async (filePath) => sidecars.get(filePath) ?? null,
      writeText: async (filePath, content) => {
        sidecars.set(filePath, content);
      },
      listBroll: async () => [],
      ensureDirs: async () => {},
    },
    fullVideoEncode: {
      async encode(input) {
        return {
          outputPath: input.outputPath,
          reused: true,
          width: 2560,
          height: 1440,
          fps: 60,
          videoBitrateMbps: 20,
          encoderLabel: "test",
          durationMs: 1,
        };
      },
    },
    settings: {
      async get() {
        return options.settings ?? settings();
      },
      async save() {},
    },
    auth: {
      async getAuthorizationUrl() {
        return "";
      },
      async exchangeCode() {
        throw new Error("unused");
      },
      async refreshAccessToken() {
        throw new Error("unused");
      },
      async getStoredTokens() {
        return {
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: new Date(now.getTime() + 3_600_000),
        };
      },
      async saveTokens() {},
    },
    upload: {
      async upload(input) {
        uploaded.push(input);
        return { youtubeVideoId: `yt-${uploaded.length}` };
      },
    },
    ...(options.withCaptions === false
      ? {}
      : {
          captions: {
            async upload(input: YouTubeCaptionUploadInput) {
              captioned.push(input);
              return { youtubeCaptionId: `caption-${captioned.length}` };
            },
          },
        }),
    ...(options.withVoiceOverDeps === false ? {} : voiceOverDeps),
    clock: { now: () => now },
  });

  return {
    handler,
    store,
    mixed,
    uploaded,
    captioned,
    generateCalls,
    checkpoints,
    sidecars,
  };
}

function makeCtx(
  target: Harness,
  overrides: Partial<JobHandlerContext> = {},
): JobHandlerContext {
  return {
    jobId: "job-1",
    payload: { sessionId: "session-1", privacy: "unlisted", voiceOver: true },
    checkpoint: null,
    setProgress() {},
    async saveCheckpoint(step, data) {
      target.checkpoints.push({ step, data });
    },
    signal: new AbortController().signal,
    shouldPause: () => false,
    throwIfPausedOrCancelled() {},
    ...overrides,
  };
}

describe("publish_full_replay voice-over mode", () => {
  it("mixes, uploads, and captions both languages from the delivery encode", async () => {
    const target = harness();

    await target.handler(makeCtx(target));

    expect(target.generateCalls).toEqual(["session-1"]);
    expect(
      target.mixed.map(
        ({ videoPath, voiceAudioPath, outputPath, voiceDuckDb, burnInCaptions }) => ({
          videoPath,
          voiceAudioPath,
          outputPath,
          voiceDuckDb,
          burnInCaptions,
        }),
      ),
    ).toEqual([
      {
        videoPath: "media/replays/session-1/full-youtube.mp4",
        voiceAudioPath: "media/replays/session-1/vo-it.mp3",
        outputPath: "media/replays/session-1/full-youtube-it.mp4",
        voiceDuckDb: -12,
        burnInCaptions: false,
      },
      {
        videoPath: "media/replays/session-1/full-youtube.mp4",
        voiceAudioPath: "media/replays/session-1/vo-en.mp3",
        outputPath: "media/replays/session-1/full-youtube-en.mp4",
        voiceDuckDb: -12,
        burnInCaptions: false,
      },
    ]);
    expect(
      target.uploaded.map(({ filePath, title, description, contentKind, privacy, tags }) => ({
        filePath,
        title,
        description,
        contentKind,
        privacy,
        tags,
      })),
    ).toEqual([
      {
        filePath: "media/replays/session-1/full-youtube-it.mp4",
        title: "Titolo it",
        description: "Descrizione it",
        contentKind: "full",
        privacy: "unlisted",
        tags: ["iRacing", "simracing"],
      },
      {
        filePath: "media/replays/session-1/full-youtube-en.mp4",
        title: "Titolo en",
        description: "Descrizione en",
        contentKind: "full",
        privacy: "unlisted",
        tags: ["iRacing", "simracing"],
      },
    ]);
    expect(
      target.captioned.map(({ youtubeVideoId, filePath, language }) => ({
        youtubeVideoId,
        filePath,
        language,
      })),
    ).toEqual([
      {
        youtubeVideoId: "yt-1",
        filePath: "media/replays/session-1/vo-it.srt",
        language: "it",
      },
      {
        youtubeVideoId: "yt-2",
        filePath: "media/replays/session-1/vo-en.srt",
        language: "en",
      },
    ]);

    const saved = target.store.session;
    expect(
      saved.fullVoiceOvers?.map(
        ({ language, renderOutputPath, youtubeVideoId, youtubeCaptionId }) => ({
          language,
          renderOutputPath,
          youtubeVideoId,
          youtubeCaptionId,
        }),
      ),
    ).toEqual([
      {
        language: "it",
        renderOutputPath: "media/replays/session-1/full-youtube-it.mp4",
        youtubeVideoId: "yt-1",
        youtubeCaptionId: "caption-1",
      },
      {
        language: "en",
        renderOutputPath: "media/replays/session-1/full-youtube-en.mp4",
        youtubeVideoId: "yt-2",
        youtubeCaptionId: "caption-2",
      },
    ]);
    expect(saved.fullVideoYoutubeId).toBe("yt-1");
    expect(saved.fullVideoPrivacy).toBe("unlisted");
    expect(saved.fullVideoPublishedAt).toEqual(now);
    expect(target.checkpoints.map(({ step }) => step)).toEqual([
      "encode",
      "voice_over",
      "mix_it",
      "upload_it",
      "upload_it",
      "captions_it",
      "captions_it",
      "mix_en",
      "upload_en",
      "upload_en",
      "captions_en",
      "captions_en",
    ]);
  });

  it("skips work already recorded on the session packages", async () => {
    const target = harness({
      session: session({
        fullVoiceOvers: [
          voiceOver("it", {
            renderOutputPath: "media/replays/session-1/full-youtube-it.mp4",
            youtubeVideoId: "yt-existing-it",
            youtubeCaptionId: "caption-existing-it",
          }),
          voiceOver("en"),
        ],
      }),
    });

    await target.handler(makeCtx(target));

    expect(target.mixed.map(({ outputPath }) => outputPath)).toEqual([
      "media/replays/session-1/full-youtube-en.mp4",
    ]);
    expect(target.uploaded).toHaveLength(1);
    expect(target.captioned.map(({ language }) => language)).toEqual(["en"]);
    expect(target.store.session.fullVideoYoutubeId).toBe("yt-existing-it");
  });

  it("recovers an upload id from the job checkpoint when the session write was lost", async () => {
    // The lost write is only the IT upload id: the earlier steps persisted the
    // encode path and both narrated renders before the crash.
    const target = harness({
      session: session({
        fullVideoEncodePath: "media/replays/session-1/full-youtube.mp4",
        fullVoiceOvers: [
          voiceOver("it", {
            renderOutputPath: "media/replays/session-1/full-youtube-it.mp4",
          }),
          voiceOver("en", {
            renderOutputPath: "media/replays/session-1/full-youtube-en.mp4",
          }),
        ],
      }),
    });
    const checkpoint: JobCheckpoint = {
      step: "upload_it",
      data: {
        language: "it",
        scriptHash: "hash-it",
        youtubeVideoId: "yt-recovered-it",
      },
    };

    await target.handler(makeCtx(target, { checkpoint }));

    expect(target.uploaded.map(({ filePath }) => filePath)).toEqual([
      "media/replays/session-1/full-youtube-en.mp4",
    ]);
    expect(target.captioned.map(({ youtubeVideoId }) => youtubeVideoId)).toEqual([
      "yt-recovered-it",
      "yt-1",
    ]);
  });

  it("recovers an upload id from the media-store sidecar and skips the mix", async () => {
    // The job row and its checkpoint are gone (queue replaced the job), so the
    // sidecar is the only record that IT already reached YouTube.
    const sidecars = new Map([
      [
        "media/replays/session-1/vo-publish-it.json",
        JSON.stringify({
          language: "it",
          scriptHash: "hash-it",
          youtubeVideoId: "yt-sidecar-it",
          youtubeCaptionId: "caption-sidecar-it",
        }),
      ],
    ]);
    const target = harness({
      sidecars,
      session: session({
        fullVideoEncodePath: "media/replays/session-1/full-youtube.mp4",
      }),
    });

    await target.handler(makeCtx(target));

    expect(target.mixed.map(({ outputPath }) => outputPath)).toEqual([
      "media/replays/session-1/full-youtube-en.mp4",
    ]);
    expect(target.uploaded.map(({ filePath }) => filePath)).toEqual([
      "media/replays/session-1/full-youtube-en.mp4",
    ]);
    expect(target.captioned.map(({ language }) => language)).toEqual(["en"]);
    expect(target.store.session.fullVideoYoutubeId).toBe("yt-sidecar-it");
    expect(
      JSON.parse(sidecars.get("media/replays/session-1/vo-publish-en.json")!),
    ).toMatchObject({
      language: "en",
      scriptHash: "hash-en",
      youtubeVideoId: "yt-1",
      youtubeCaptionId: "caption-1",
    });
  });

  it("ignores a sidecar written for a different script hash", async () => {
    const target = harness({
      sidecars: new Map([
        [
          "media/replays/session-1/vo-publish-it.json",
          JSON.stringify({
            language: "it",
            scriptHash: "hash-di-un-vecchio-copione",
            youtubeVideoId: "yt-stale-it",
          }),
        ],
      ]),
    });

    await target.handler(makeCtx(target));

    expect(target.uploaded).toHaveLength(2);
    expect(target.store.session.fullVideoYoutubeId).toBe("yt-1");
  });

  it("ducks the race only for the narration span", async () => {
    const target = harness({
      packages: [
        voiceOver("it", {
          words: [
            { text: "via", startMs: 0, endMs: 200 },
            { text: "bandiera", startMs: 700_000, endMs: 754_200 },
          ],
        }),
        voiceOver("en", { words: [] }),
      ],
    });

    await target.handler(makeCtx(target));

    expect(target.mixed.map(({ voiceDurationMs }) => voiceDurationMs)).toEqual([
      754_200,
      undefined,
    ]);
  });

  it("burns captions into both languages when the setting is on", async () => {
    const target = harness({ settings: settings({ fullBurnInCaptions: true }) });

    await target.handler(makeCtx(target));

    expect(
      target.mixed.map(({ burnInCaptions, subtitlesPath }) => ({
        burnInCaptions,
        subtitlesPath,
      })),
    ).toEqual([
      { burnInCaptions: true, subtitlesPath: "media/replays/session-1/vo-it.srt" },
      { burnInCaptions: true, subtitlesPath: "media/replays/session-1/vo-en.srt" },
    ]);
  });

  it("fails when the captions adapter is not configured", async () => {
    const target = harness({ withCaptions: false });

    await expect(target.handler(makeCtx(target))).rejects.toThrow(
      /captions adapter/i,
    );
  });

  it("fails when voice-over dependencies are missing", async () => {
    const target = harness({ withVoiceOverDeps: false });

    await expect(target.handler(makeCtx(target))).rejects.toThrow(
      /voice-over/i,
    );
  });

  it("leaves the silent single upload path untouched", async () => {
    const target = harness();

    await target.handler(
      makeCtx(target, { payload: { sessionId: "session-1", privacy: "public" } }),
    );

    expect(target.generateCalls).toEqual([]);
    expect(target.mixed).toEqual([]);
    expect(target.uploaded).toHaveLength(1);
    expect(target.uploaded[0]?.filePath).toBe(
      "media/replays/session-1/full-youtube.mp4",
    );
    expect(target.store.session.fullVideoYoutubeId).toBe("yt-1");
  });
});
