import { describe, expect, it } from "vitest";

import { createPublishVoShortPair } from "@/src/application/publish-vo-short-pair";
import type { ShortCandidate } from "@/src/domain/entities";
import type { Logger } from "@/src/ports/logger";

const now = new Date("2026-08-12T10:00:00.000Z");

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

function candidate(): ShortCandidate {
  return {
    id: "candidate-42",
    origin: "replay",
    status: "rendering",
    title: "Fallback title",
    description: "Fallback description",
    tags: ["simracing"],
    score: 0.96,
    provenance: {
      replaySessionId: "replay-1",
      startMs: 10_000,
      endMs: 28_000,
      hookReason: "Late braking pass",
      eventType: "overtake",
      crop: { mode: "center_vertical", focusX: 0.5 },
    },
    renderOutputPath: null,
    voiceOvers: [
      {
        language: "it",
        script: "Sorpasso decisivo.",
        title: "Sorpasso all'ultimo giro",
        description: "La staccata decisiva.",
        voiceProfile: "coral",
        audioPath: "media/voice/vo-it.mp3",
        words: [],
        srtPath: "media/voice/vo-it.srt",
        assPath: "media/voice/vo-it.ass",
        scriptHash: "it-hash",
        renderOutputPath: "media/renders/vo-it.mp4",
      },
      {
        language: "en",
        script: "The decisive pass.",
        title: "Last-lap overtake",
        description: "The decisive braking move.",
        voiceProfile: "coral",
        audioPath: "media/voice/vo-en.mp3",
        words: [],
        srtPath: "media/voice/vo-en.srt",
        assPath: "media/voice/vo-en.ass",
        scriptHash: "en-hash",
        renderOutputPath: "media/renders/vo-en.mp4",
      },
    ],
    scheduledAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("publish VO Short pair", () => {
  it("enqueues localized IT and EN uploads with their SRT captions", async () => {
    const queued: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const publish = createPublishVoShortPair({
      candidates: {
        save: async () => {},
        getById: async () => candidate(),
        list: async () => [],
      },
      queue: {
        enqueue: async (job) => {
          queued.push(job);
          return `publish-${queued.length}`;
        },
        getProgress: async () => null,
        listJobs: () => [],
      },
      logger: logger(),
    });

    await expect(publish({ candidateId: "candidate-42" })).resolves.toEqual([
      "publish-1",
      "publish-2",
    ]);
    expect(queued).toEqual([
      {
        type: "publish_short",
        payload: {
          candidateId: "candidate-42",
          language: "it",
          filePath: "media/renders/vo-it.mp4",
          srtPath: "media/voice/vo-it.srt",
          title: "Sorpasso all'ultimo giro",
          description: "La staccata decisiva.",
        },
      },
      {
        type: "publish_short",
        payload: {
          candidateId: "candidate-42",
          language: "en",
          filePath: "media/renders/vo-en.mp4",
          srtPath: "media/voice/vo-en.srt",
          title: "Last-lap overtake",
          description: "The decisive braking move.",
        },
      },
    ]);
  });

  it("rejects before enqueue when either rendered video or SRT is missing", async () => {
    const incomplete = candidate();
    incomplete.voiceOvers![1] = {
      ...incomplete.voiceOvers![1]!,
      renderOutputPath: null,
    };
    let enqueueCount = 0;
    const publish = createPublishVoShortPair({
      candidates: {
        save: async () => {},
        getById: async () => incomplete,
        list: async () => [],
      },
      queue: {
        enqueue: async () => {
          enqueueCount += 1;
          return "unexpected";
        },
        getProgress: async () => null,
        listJobs: () => [],
      },
      logger: logger(),
    });

    await expect(publish({ candidateId: incomplete.id })).rejects.toThrow(
      /render output.*en/i,
    );
    expect(enqueueCount).toBe(0);
  });

  it("does not enqueue an active language job twice", async () => {
    const queued: string[] = [];
    const publish = createPublishVoShortPair({
      candidates: {
        save: async () => {},
        getById: async () => candidate(),
        list: async () => [],
      },
      queue: {
        enqueue: async ({ payload }) => {
          queued.push(String(payload.language));
          return `publish-${payload.language}`;
        },
        getProgress: async () => null,
        listJobs: () => [
          {
            id: "publish-it",
            type: "publish_short",
            payload: { candidateId: "candidate-42", language: "it" },
            status: "running",
            position: 1,
            progressPct: 50,
            progressMessage: "Uploading",
            checkpoint: null,
            error: null,
            createdAt: now,
            startedAt: now,
            finishedAt: null,
            updatedAt: now,
          },
        ],
      },
      logger: logger(),
    });

    await expect(publish({ candidateId: "candidate-42" })).resolves.toEqual([
      "publish-it",
      "publish-en",
    ]);
    expect(queued).toEqual(["en"]);
  });
});
