import { describe, expect, it } from "vitest";

import type { ReplaySession } from "@/src/domain/entities";
import type { RaceAnalysis } from "@/src/domain/race-analysis";
import type { VoiceOverPackage } from "@/src/domain/voice-over";
import type { DeliveryAssetBundle } from "@/src/domain/youtube-metadata";
import type { Logger } from "@/src/ports/logger";
import type { YouTubeCaptionUploadInput } from "@/src/ports/youtube-captions";
import type { YouTubeUploadInput } from "@/src/ports/youtube-upload";
import type { YouTubeLocalizationUpdateInput } from "@/src/ports/youtube-upload";
import type { JobHandlerContext } from "@/src/workers/job-handler-context";
import { createPublishFullReplayHandler } from "@/src/workers/publish-full-replay-handler";

const now = new Date("2026-08-13T10:00:00.000Z");

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

function analysis(): RaceAnalysis {
  return {
    version: 1,
    focusCarHint: "pi",
    context: {
      simulator: "iRacing",
      track: "Oschersleben",
      car: "GR86",
      durationSec: 900,
    },
    results: {
      qualiResult: "both laps invalid",
      startPosition: 18,
      finishPosition: 8,
      fieldSize: 20,
      positionsGained: 10,
    },
    recurringRivals: [],
    events: [],
    timeline: [],
    storylines: [
      {
        kind: "main",
        summary: "P18 to P8",
        whyWatch: "Starts P18 finishes P8",
      },
    ],
    mainStoryline: "Quali disaster → P18 → P8",
    whyWatch: "Parte P18 arriva P8",
    potentialHooks: ["P18 → P8"],
    shortCandidates: [
      {
        shortScore: 0.9,
        startMs: 0,
        endMs: 20_000,
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
    narrativeIt: "Parto P18.",
    audioTranscript: "",
    audioSource: "muxed" as const,
    audioTranscriptSegments: [],
    commentaryMarkers: [],
    hudTimeline: [],
  };
}

function voiceOver(
  language: "it" | "en",
  overrides: Partial<VoiceOverPackage> = {},
): VoiceOverPackage {
  return {
    language,
    script: `Script ${language}`,
    title: `Title ${language}`,
    description: `Description ${language}`,
    voiceProfile: "coral",
    audioPath: `media/replays/session-1/vo-${language}.mp3`,
    words: [{ text: "go", startMs: 0, endMs: 200 }],
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
    commentaryPath: null,
    commentaryOffsetMs: 0,
    trackName: "Oschersleben",
    focusCarIdx: null,
    title: "Race",
    durationSec: 900,
    status: "ready",
    events: [],
    racePackage: {
      focusCarHint: "pi",
      transcript: "Gara",
      timeline: [],
      fullVideo: {
        title: "Titolo gara",
        description: "Desc",
        tags: ["iRacing"],
      },
      audioTranscript: "",
    },
    raceAnalysis: analysis(),
    fullVideoEncodePath: null,
    fullVideoYoutubeId: null,
    fullVideoPrivacy: null,
    fullVideoPublishedAt: null,
    fullVoiceOvers: null,
    deliveryAssets: null,
    publishManualChecklist: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function fakeCtx(): JobHandlerContext & {
  checkpoints: Array<{ step: string; data?: unknown }>;
} {
  const checkpoints: Array<{ step: string; data?: unknown }> = [];
  return {
    jobId: "job-1",
    payload: { sessionId: "session-1", privacy: "unlisted", voiceOver: true },
    checkpoint: null,
    signal: new AbortController().signal,
    shouldPause: () => false,
    throwIfPausedOrCancelled() {},
    async saveCheckpoint(step, data) {
      checkpoints.push({ step, data });
    },
    setProgress() {},
    checkpoints,
  };
}

describe("publish_full_replay single-master", () => {
  it("uploads one master, sets localizations, and uploads captions", async () => {
    let stored = session();
    const uploads: YouTubeUploadInput[] = [];
    const localizations: YouTubeLocalizationUpdateInput[] = [];
    const captions: YouTubeCaptionUploadInput[] = [];
    const ctx = fakeCtx();

    const handler = createPublishFullReplayHandler({
      logger: logger(),
      clock: { now: () => now },
      replaySessions: {
        async getById() {
          return stored;
        },
        async save(next) {
          stored = next;
        },
        async list() {
          return [stored];
        },
      },
      mediaStore: {
        sourcePath: () => "",
        renderPath: () => "",
        audioPath: () => "",
        brollPath: () => "",
        replayAnalysisDir: () => "media/replays/session-1",
        fullReplayEncodePath: () => "media/replays/session-1/full-youtube.mp4",
        fullReplayMasterPath: () =>
          "media/replays/session-1/delivery/master_video.mp4",
        listBroll: async () => [],
        ensureDirs: async () => undefined,
      },
      fullVideoEncode: {
        async encode({ outputPath }) {
          return {
            outputPath,
            reused: false,
            encoderLabel: "libx264",
            videoBitrateMbps: 8,
          };
        },
      },
      generateFullVoiceOvers: async () => {
        const packages = [voiceOver("it"), voiceOver("en")];
        stored = { ...stored, fullVoiceOvers: packages };
        return packages;
      },
      packageFullDeliveryAssets: async () => {
        const bundle: DeliveryAssetBundle = {
          sessionId: "session-1",
          raceAnalysisPath: "media/replays/session-1/delivery/race_analysis.json",
          youtubeMetadataPath:
            "media/replays/session-1/delivery/youtube_metadata.json",
          masterVideoPath:
            "media/replays/session-1/delivery/master_video.mp4",
          audioItPath: "media/replays/session-1/delivery/audio_it.m4a",
          audioEnPath: "media/replays/session-1/delivery/audio_en.m4a",
          subtitlesItPath: "media/replays/session-1/delivery/subtitles_it.srt",
          subtitlesEnPath: "media/replays/session-1/delivery/subtitles_en.srt",
          thumbnailItPath: null,
          thumbnailEnPath: null,
          thumbnailConcept: {
            universalText: "P18 → P8",
            textIt: null,
            textEn: null,
            rationale: "position swing",
          },
          metadata: {
            originalLanguage: "it",
            contentKind: "full",
            masterVideo: "media/replays/session-1/delivery/master_video.mp4",
            requiresLocalizedRender: false,
            localizations: {
              it: {
                title: "Title it",
                description: "Description it",
                audio: "media/replays/session-1/delivery/audio_it.m4a",
                subtitles: "media/replays/session-1/delivery/subtitles_it.srt",
                thumbnail: null,
              },
              en: {
                title: "Title en",
                description: "Description en",
                audio: "media/replays/session-1/delivery/audio_en.m4a",
                subtitles: "media/replays/session-1/delivery/subtitles_en.srt",
                thumbnail: null,
              },
            },
            manualStudioChecklist: ["Attach secondary audio in Studio"],
          },
        };
        stored = {
          ...stored,
          deliveryAssets: bundle,
          publishManualChecklist: bundle.metadata.manualStudioChecklist,
          fullVoiceOvers: [voiceOver("it"), voiceOver("en")],
        };
        return bundle;
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
            accessToken: "token",
            refreshToken: "refresh",
            expiresAt: new Date(now.getTime() + 3_600_000),
          };
        },
        async saveTokens() {},
      },
      upload: {
        async upload(input) {
          uploads.push(input);
          return { youtubeVideoId: "yt-master-1" };
        },
        async updateLocalizations(input) {
          localizations.push(input);
        },
      },
      captions: {
        async upload(input) {
          captions.push(input);
          return { youtubeCaptionId: `cap-${input.language}` };
        },
      },
      settings: {
        async get() {
          return {
            brandRoot: "",
            logLevel: "INFO",
            defaultPrivacy: "unlisted",
            videoEncoderPreference: "libx264",
            brandVoiceProfile: "coral",
            italianVoiceProfile: "ash",
            shortsBurnInCaptions: true,
            fullBurnInCaptions: false,
            voiceDuckDb: -12,
            enableVoiceOverPipeline: true,
          };
        },
        async save() {},
      },
    });

    await handler(ctx);

    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.filePath).toContain("master_video.mp4");
    expect(uploads[0]?.defaultLanguage).toBe("it");
    expect(localizations).toHaveLength(1);
    expect(localizations[0]?.localizations.en.title).toBe("Title en");
    expect(captions.map((item) => item.language).sort()).toEqual(["en", "it"]);
    expect(stored.fullVideoYoutubeId).toBe("yt-master-1");
    expect(stored.publishManualChecklist?.length).toBeGreaterThan(0);
  });
});
