import { describe, expect, it, vi } from "vitest";

import { createYoutubeUploadCircuitBreaker } from "@/src/application/youtube-upload-circuit-breaker";
import { resumeDeferredYoutubeUploads } from "@/src/application/resume-deferred-youtube-uploads";
import type { JobRecord } from "@/src/adapters/jobs/job-record";
import { youtubeDailyUploadLimitCheckpoint } from "@/src/domain/youtube-upload-limit";
import type { Logger } from "@/src/ports/logger";

function silentLogger(): Logger {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => logger,
  };
  return logger;
}

describe("resumeDeferredYoutubeUploads", () => {
  it("resumes paused publish jobs whose retryAfter has passed", async () => {
    const now = new Date("2026-08-13T14:00:00.000Z");
    const ready = youtubeDailyUploadLimitCheckpoint(
      1,
      new Date("2026-08-13T13:00:00.000Z"),
    );
    const waiting = youtubeDailyUploadLimitCheckpoint(
      1,
      new Date("2026-08-13T15:00:00.000Z"),
    );
    const jobs: JobRecord[] = [
      {
        id: "ready",
        type: "publish_short",
        status: "paused",
        payload: {},
        position: 0,
        progressPct: 0,
        progressMessage: "",
        error: null,
        checkpoint: { step: "prepare", data: ready },
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        finishedAt: null,
      },
      {
        id: "waiting",
        type: "publish_short",
        status: "paused",
        payload: {},
        position: 1,
        progressPct: 0,
        progressMessage: "",
        error: null,
        checkpoint: { step: "prepare", data: waiting },
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        finishedAt: null,
      },
    ];
    const resume = vi.fn(async (id: string) => {
      const job = jobs.find((item) => item.id === id);
      if (job) job.status = "queued";
      return { ok: true as const };
    });
    const breaker = createYoutubeUploadCircuitBreaker();
    const result = await resumeDeferredYoutubeUploads({
      queue: {
        listJobs: () => jobs,
        resume,
      },
      breaker,
      logger: silentLogger(),
      now: () => now,
    });
    expect(result.resumed).toBe(1);
    expect(resume).toHaveBeenCalledWith("ready");
    expect(jobs.find((job) => job.id === "ready")?.status).toBe("queued");
    expect(jobs.find((job) => job.id === "waiting")?.status).toBe("paused");
    expect(breaker.isBlocked(now)).toBe(true);
  });
});
