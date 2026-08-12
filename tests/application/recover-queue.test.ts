import { describe, expect, it, vi } from "vitest";

import { createInProcessJobQueue } from "@/src/adapters/jobs/in-process-queue";
import { createRecoverQueue } from "@/src/application/recover-queue";
import type { ShortCandidate } from "@/src/domain/entities";
import type { VoiceOverPackage } from "@/src/domain/voice-over";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { Logger } from "@/src/ports/logger";

const now = new Date("2026-08-11T10:00:00.000Z");

function candidate(
  id: string,
  status: ShortCandidate["status"],
): ShortCandidate {
  return {
    id,
    origin: "clip",
    status,
    title: id,
    description: "",
    tags: [],
    score: 1,
    provenance: {
      sourceVideoId: "source-1",
      startMs: 0,
      endMs: 1_000,
      hookReason: "Recovery test",
      crop: { mode: "center_vertical", focusX: 0.5 },
    },
    renderOutputPath: null,
    scheduledAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function voiceOverPackage(
  language: "it" | "en",
  overrides: Partial<VoiceOverPackage> = {},
): VoiceOverPackage {
  return {
    language,
    script: `Script ${language}`,
    title: `Titolo ${language}`,
    description: `Descrizione ${language}`,
    voiceProfile: "coral",
    audioPath: `media/voice/vo-${language}.mp3`,
    words: [],
    srtPath: `media/voice/vo-${language}.srt`,
    assPath: `media/voice/vo-${language}.ass`,
    scriptHash: `${language}-hash`,
    ...overrides,
  };
}

describe("recover queue", () => {
  it("requeues running jobs and repairs only orphaned in-progress candidates", async () => {
    const candidates = [
      candidate("render-orphan", "rendering"),
      candidate("publish-orphan", "publishing"),
      candidate("render-active", "rendering"),
      candidate("ready", "ready"),
    ];
    const repository: CandidateRepository = {
      async save() {},
      async getById(id) {
        return candidates.find((item) => item.id === id) ?? null;
      },
      async list() {
        return candidates;
      },
    };
    let nextId = 0;
    const warn = vi.fn();
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
      child: () => logger,
    };
    const queue = createInProcessJobQueue({
      logger,
      idPort: { generate: () => `job-${++nextId}` },
      clock: { now: () => now },
    });
    const activeId = await queue.enqueue({
      type: "render_short",
      payload: { candidateId: "render-active" },
    });
    queue.markRunning(activeId);

    const recover = createRecoverQueue({ queue, candidates: repository, logger });

    await expect(recover()).resolves.toEqual({
      requeuedRunning: 1,
      repairedCandidates: 2,
    });
    const jobs = queue.listJobs().map(({ type, payload, status }) => ({
      type,
      payload,
      status,
    }));
    expect(jobs).toHaveLength(3);
    expect(jobs).toEqual(expect.arrayContaining([
      {
        type: "render_short",
        payload: { candidateId: "render-active" },
        status: "queued",
      },
      {
        type: "render_short",
        payload: { candidateId: "render-orphan" },
        status: "queued",
      },
      {
        type: "publish_short",
        payload: { candidateId: "publish-orphan" },
        status: "queued",
      },
    ]));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      "Repaired orphan candidate with recovery job",
      { candidateId: "render-orphan", status: "rendering" },
    );
  });

  it("repairs orphaned VO renders with one localized job per unrendered package", async () => {
    const renderingCandidate: ShortCandidate = {
      ...candidate("render-vo-orphan", "rendering"),
      voiceOvers: [
        voiceOverPackage("it", {
          renderOutputPath: "media/renders/vo-it.mp4",
        }),
        voiceOverPackage("en"),
      ],
    };
    const repository: CandidateRepository = {
      async save() {},
      async getById() {
        return renderingCandidate;
      },
      async list() {
        return [renderingCandidate];
      },
    };
    const warn = vi.fn();
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
      child: () => logger,
    };
    const queue = createInProcessJobQueue({
      logger,
      idPort: { generate: () => "recovered-render-en" },
      clock: { now: () => now },
    });

    const recover = createRecoverQueue({ queue, candidates: repository, logger });

    await expect(recover()).resolves.toEqual({
      requeuedRunning: 0,
      repairedCandidates: 1,
    });
    expect(
      queue.listJobs().map(({ type, payload }) => ({ type, payload })),
    ).toEqual([
      {
        type: "render_short",
        payload: { candidateId: "render-vo-orphan", language: "en" },
      },
    ]);
    expect(warn).toHaveBeenCalledWith("Repaired orphan voice-over render jobs", {
      candidateId: "render-vo-orphan",
      localizedJobs: 1,
    });
  });

  it("leaves a VO render alone when its language job is already queued", async () => {
    const renderingCandidate: ShortCandidate = {
      ...candidate("render-vo-active", "rendering"),
      voiceOvers: [voiceOverPackage("it"), voiceOverPackage("en")],
    };
    const repository: CandidateRepository = {
      async save() {},
      async getById() {
        return renderingCandidate;
      },
      async list() {
        return [renderingCandidate];
      },
    };
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: () => logger,
    };
    let nextId = 0;
    const queue = createInProcessJobQueue({
      logger,
      idPort: { generate: () => `job-${++nextId}` },
      clock: { now: () => now },
    });
    await queue.enqueue({
      type: "render_short",
      payload: { candidateId: "render-vo-active", language: "it" },
    });

    const recover = createRecoverQueue({ queue, candidates: repository, logger });

    await expect(recover()).resolves.toEqual({
      requeuedRunning: 0,
      repairedCandidates: 1,
    });
    expect(
      queue
        .listJobs()
        .map(({ payload }) => payload.language)
        .sort(),
    ).toEqual(["en", "it"]);
  });

  it("repairs orphaned VO publishes with one localized job per incomplete package", async () => {
    const voiceOverCandidate: ShortCandidate = {
      ...candidate("publish-vo-orphan", "publishing"),
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
          youtubeVideoId: "youtube-it",
          youtubeCaptionId: "caption-it",
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
    };
    const repository: CandidateRepository = {
      async save() {},
      async getById() {
        return voiceOverCandidate;
      },
      async list() {
        return [voiceOverCandidate];
      },
    };
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: () => logger,
    };
    const queue = createInProcessJobQueue({
      logger,
      idPort: { generate: () => "recovered-publish-en" },
      clock: { now: () => now },
    });

    const recover = createRecoverQueue({ queue, candidates: repository, logger });

    await expect(recover()).resolves.toEqual({
      requeuedRunning: 0,
      repairedCandidates: 1,
    });
    expect(queue.listJobs()).toEqual([
      expect.objectContaining({
        type: "publish_short",
        payload: {
          candidateId: "publish-vo-orphan",
          language: "en",
          filePath: "media/renders/vo-en.mp4",
          srtPath: "media/voice/vo-en.srt",
          title: "Last-lap overtake",
          description: "The decisive braking move.",
        },
      }),
    ]);
  });
});
