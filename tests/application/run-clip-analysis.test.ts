import { describe, expect, it } from "vitest";

import { createRunClipAnalysis } from "@/src/application/run-clip-analysis";
import type { ShortCandidate, SourceVideo } from "@/src/domain/entities";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { Logger } from "@/src/ports/logger";
import type { SourceVideoRepository } from "@/src/ports/source-video-repository";

const now = new Date("2026-08-11T10:00:00.000Z");

class MemorySourceVideoRepository implements SourceVideoRepository {
  constructor(readonly video: SourceVideo) {}

  async save(video: SourceVideo): Promise<void> {
    Object.assign(this.video, video);
  }

  async getById(id: string): Promise<SourceVideo | null> {
    return this.video.id === id ? this.video : null;
  }

  async getByYoutubeVideoId(youtubeVideoId: string): Promise<SourceVideo | null> {
    return this.video.youtubeVideoId === youtubeVideoId ? this.video : null;
  }

  async listByChannelId(channelId: string): Promise<SourceVideo[]> {
    return this.video.channelId === channelId ? [this.video] : [];
  }

  async upsertMany(): Promise<void> {}

  async deleteByIds(): Promise<void> {}
}

class MemoryCandidateRepository implements CandidateRepository {
  readonly items: ShortCandidate[] = [];

  async save(candidate: ShortCandidate): Promise<void> {
    this.items.push(candidate);
  }

  async getById(id: string): Promise<ShortCandidate | null> {
    return this.items.find((candidate) => candidate.id === id) ?? null;
  }

  async listByIds(ids: string[]): Promise<ShortCandidate[]> {
    return this.items.filter((candidate) => ids.includes(candidate.id));
  }

  async list(): Promise<ShortCandidate[]> {
    return this.items;
  }
}

function createLogger(): Logger {
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child: () => logger,
  };
  return logger;
}

describe("runClipAnalysis", () => {
  it("downloads the source and saves proposed clip candidates with timestamp provenance", async () => {
    const sourceVideos = new MemorySourceVideoRepository({
      id: "source-1",
      channelId: "channel-1",
      youtubeVideoId: "youtube-1",
      title: "Fastest lap breakdown",
      durationSec: 180,
      localMediaPath: null,
      analyticsSnapshot: null,
      publishedAt: now,
      syncedAt: now,
    });
    const candidates = new MemoryCandidateRepository();
    const downloaded: string[] = [];
    const runClipAnalysis = createRunClipAnalysis({
      llm: {
        complete: async () =>
          JSON.stringify({
            windows: [
              {
                startMs: 12_000,
                endMs: 42_000,
                title: "The braking trick that saves a lap",
                description: "A concise breakdown of late braking.",
                tags: ["racing", "braking"],
                score: 0.91,
                hookReason: "The counterintuitive claim creates immediate curiosity.",
              },
            ],
          }),
      },
      videoDownload: {
        download: async (youtubeVideoId) => {
          downloaded.push(youtubeVideoId);
          return "media/youtube-1.mp4";
        },
      },
      sourceVideos,
      candidates,
      id: { generate: () => "candidate-1" },
      clock: { now: () => now },
      logger: createLogger(),
    });

    const result = await runClipAnalysis({ sourceVideoId: "source-1" });

    expect(downloaded).toEqual(["youtube-1"]);
    expect(sourceVideos.video.localMediaPath).toBe("media/youtube-1.mp4");
    expect(result).toEqual(candidates.items);
    expect(result).toEqual([
      expect.objectContaining({
        id: "candidate-1",
        origin: "clip",
        status: "proposed",
        title: "The braking trick that saves a lap",
        description:
          "A concise breakdown of late braking.\n\nFull video: https://youtu.be/youtube-1",
        score: 0.91,
        provenance: {
          sourceVideoId: "source-1",
          startMs: 12_000,
          endMs: 42_000,
          hookReason: "The counterintuitive claim creates immediate curiosity.",
          crop: { mode: "center_vertical", focusX: 0.5 },
        },
      }),
    ]);
  });
});
