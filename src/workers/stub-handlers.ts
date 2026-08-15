import { createHandlers, type HandlerDeps } from "./handlers";
import type { JobHandlers } from "./job-handler-context";

const noopDeps: HandlerDeps = {
  logger: {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() {
      return this;
    },
  },
  sourceVideos: {
    async save() {},
    async getById() {
      return null;
    },
    async getByYoutubeVideoId() {
      return null;
    },
    async listByChannelId() {
      return [];
    },
    async upsertMany() {},
    async deleteByIds() {},
  },
  replaySessions: {
    async save() {},
    async getById() {
      return null;
    },
    async list() {
      return [];
    },
  },
  videoDownload: {
    async download() {
      return "";
    },
  },
  async runClipAnalysis() {
    return [];
  },
  async runReplayAnalysis() {
    return [];
  },
  async requestReplayCapture({ sessionId }) {
    throw new Error(`Replay session not found: ${sessionId}`);
  },
  async runReplayDirectorCapture({ sessionId }) {
    throw new Error(`Replay session not found: ${sessionId}`);
  },
  async runIdeation() {
    return [];
  },
  async runMatchProposeShorts() {
    return { candidates: [], successes: 0, fillCount: 0 };
  },
  syncInspiration: {
    async run() {
      return {
        id: "",
        status: "failed",
        ideaCount: 0,
        source: "manual",
        errorMessage: "syncInspiration is not wired",
      };
    },
  },
  async assembleGeneratePreview({ candidateId }) {
    throw new Error(`Generate candidate not found: ${candidateId}`);
  },
  candidates: {
    async save() {},
    async getById() {
      return null;
    },
    async listByIds() {
      return [];
    },
    async list() {
      return [];
    },
  },
  jobs: {
    async saveRenderJob() {},
    async savePublishJob() {},
    async getRenderJobById() {
      return null;
    },
    async getPublishJobById() {
      return null;
    },
    async getRenderJobByCandidateId() {
      return null;
    },
    async getPublishJobByCandidateId() {
      return null;
    },
    async listPublishJobsByCandidateIds() {
      return [];
    },
  },
  render: {
    async render(input) {
      return { outputPath: input.outputPath };
    },
  },
  brandPack: {
    async resolve() {
      return {
        tokens: {
          colors: { carbon: "#08080A", ice: "#F4F7FA" },
          racingColors: { rossoCorsa: "#E10600" },
        },
        logoStackedPath: "",
        storyTemplatePath: "",
        accentHex: "#E10600",
      };
    },
  },
  mediaStore: {
    sourcePath() {
      return "";
    },
    renderPath() {
      return "";
    },
    audioPath() {
      return "";
    },
    brollPath() {
      return "";
    },
    replayAnalysisDir() {
      return "";
    },
    fullReplayEncodePath() {
      return "";
    },
    async listBroll() {
      return [];
    },
    async ensureDirs() {},
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
        encoderLabel: "stub",
        durationMs: 1,
      };
    },
  },
  queue: {
    async enqueue() {
      return "";
    },
    async getProgress() {
      return null;
    },
    listJobs() {
      return [];
    },
  },
  settings: {
    async get() {
      return {
        brandRoot: "",
        logLevel: "INFO",
        defaultPrivacy: "unlisted",
        videoEncoderPreference: "auto_igpu",
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
  auth: {
    async getAuthorizationUrl() {
      return "";
    },
    async exchangeCode() {
      throw new Error("YouTube auth is unavailable");
    },
    async refreshAccessToken() {
      throw new Error("YouTube auth is unavailable");
    },
    async getStoredTokens() {
      return null;
    },
    async saveTokens() {},
  },
  upload: {
    async upload() {
      throw new Error("YouTube upload is unavailable");
    },
  },
  clock: {
    now() {
      return new Date();
    },
  },
};

export function createStubHandlers(): JobHandlers {
  return createHandlers(noopDeps);
}
