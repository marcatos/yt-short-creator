import { describe, expect, it, vi } from "vitest";

import { createInProcessJobQueue } from "@/src/adapters/jobs/in-process-queue";
import { createRecoverQueue } from "@/src/application/recover-queue";
import type { ShortCandidate } from "@/src/domain/entities";
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
});
