import { describe, expect, it, vi } from "vitest";

import {
  deferPublishForYoutubeDailyLimit,
  uploadOrDeferDailyLimit,
} from "@/src/application/defer-youtube-upload";
import { createYoutubeUploadCircuitBreaker } from "@/src/application/youtube-upload-circuit-breaker";
import type { JobRecord } from "@/src/adapters/jobs/job-record";
import { JobPausedError } from "@/src/domain/queue-control";
import {
  isYoutubeDailyUploadLimitCheckpoint,
  YouTubeUploadLimitExceededError,
} from "@/src/domain/youtube-upload-limit";
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

function job(partial: Partial<JobRecord> & Pick<JobRecord, "id" | "type" | "status">): JobRecord {
  return {
    payload: {},
    position: 0,
    progressPct: 0,
    progressMessage: "",
    error: null,
    checkpoint: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    ...partial,
  };
}

describe("deferPublishForYoutubeDailyLimit", () => {
  it("checkpoints the current job and parks other queued publishes", async () => {
    const jobs = new Map<string, JobRecord>([
      [
        "running",
        job({
          id: "running",
          type: "publish_short",
          status: "running",
          checkpoint: { step: "prepare" },
        }),
      ],
      ["queued-pub", job({ id: "queued-pub", type: "publish_short", status: "queued" })],
      ["queued-render", job({ id: "queued-render", type: "render_short", status: "queued" })],
    ]);
    const queue = {
      getJob: (id: string) => jobs.get(id),
      listJobs: () => [...jobs.values()],
      saveCheckpoint: vi.fn(async (id: string, step: string, data?: unknown) => {
        const record = jobs.get(id);
        if (record) record.checkpoint = { step, data };
      }),
      setProgress: vi.fn((id: string, pct: number, message: string) => {
        const record = jobs.get(id);
        if (record) {
          record.progressPct = pct;
          record.progressMessage = message;
        }
      }),
      markPaused: vi.fn((id: string) => {
        const record = jobs.get(id);
        if (record) record.status = "paused";
      }),
    };
    const breaker = createYoutubeUploadCircuitBreaker();
    const now = new Date("2026-08-13T12:00:00.000Z");
    vi.setSystemTime(now);

    const result = await deferPublishForYoutubeDailyLimit(
      { queue, breaker, logger: silentLogger() },
      {
        jobId: "running",
        jobType: "publish_short",
        error: new YouTubeUploadLimitExceededError({ attempt: 1 }),
      },
    );

    expect(result.attempt).toBe(1);
    expect(result.retryAfter.toISOString()).toBe("2026-08-13T13:00:00.000Z");
    expect(jobs.get("running")?.checkpoint?.step).toBe("prepare");
    expect(
      isYoutubeDailyUploadLimitCheckpoint(jobs.get("running")?.checkpoint?.data),
    ).toBe(true);
    expect(jobs.get("queued-pub")?.status).toBe("paused");
    expect(jobs.get("queued-render")?.status).toBe("queued");
    expect(breaker.isBlocked(now)).toBe(true);
    vi.useRealTimers();
  });

  it("uploadOrDeferDailyLimit pauses on limit and records success otherwise", async () => {
    const breaker = createYoutubeUploadCircuitBreaker();
    const queue = {
      getJob: () => undefined,
      listJobs: () => [],
      saveCheckpoint: vi.fn(async () => undefined),
      setProgress: vi.fn(),
      markPaused: vi.fn(),
    };
    await expect(
      uploadOrDeferDailyLimit(
        { queue, breaker, logger: silentLogger() },
        { jobId: "j1", jobType: "publish_short" },
        async () => {
          throw new YouTubeUploadLimitExceededError({ attempt: 1 });
        },
      ),
    ).rejects.toBeInstanceOf(JobPausedError);

    const ok = await uploadOrDeferDailyLimit(
      { queue, breaker, logger: silentLogger() },
      { jobId: "j2", jobType: "publish_short" },
      async () => ({ youtubeVideoId: "abc" }),
    );
    expect(ok).toEqual({ youtubeVideoId: "abc" });
    expect(breaker.isBlocked()).toBe(false);
  });
});
