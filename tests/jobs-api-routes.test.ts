import { beforeEach, describe, expect, it, vi } from "vitest";

const jobQueue = vi.hoisted(() => ({
  listJobs: vi.fn(),
  getProgress: vi.fn(),
  getJob: vi.fn(),
  requestPause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  move: vi.fn(),
  reorder: vi.fn(),
}));

vi.mock("@/src/lib/container", () => ({
  getContainer: () => ({ jobQueue }),
}));

import { GET as listJobs } from "@/app/api/jobs/route";
import { GET as getProgress } from "@/app/api/jobs/[id]/progress/route";
import { POST as pauseJob } from "@/app/api/jobs/[id]/pause/route";
import { POST as resumeJob } from "@/app/api/jobs/[id]/resume/route";
import { POST as cancelJob } from "@/app/api/jobs/[id]/cancel/route";
import { POST as moveJob } from "@/app/api/jobs/[id]/move/route";
import { POST as reorderJobs } from "@/app/api/jobs/reorder/route";

describe("job query API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes queue position and checkpoint step in the job list", async () => {
    jobQueue.listJobs.mockReturnValue([
      {
        id: "job-1",
        type: "render",
        payload: { candidateId: "candidate-1" },
        status: "queued",
        position: 3,
        progressPct: 25,
        progressMessage: "Preparing",
        checkpoint: { step: "prepare", data: null },
        createdAt: new Date("2026-08-11T10:00:00.000Z"),
        startedAt: null,
        finishedAt: null,
      },
    ]);

    const response = await listJobs();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.jobs[0]).toMatchObject({
      id: "job-1",
      status: "queued",
      position: 3,
      checkpointStep: "prepare",
    });
  });

  it("returns the queue progress view unchanged", async () => {
    jobQueue.getProgress.mockResolvedValue({
      pct: 60,
      message: "Rendering",
      status: "running",
      checkpointStep: "encode",
    });

    const response = await getProgress(new Request("http://localhost"), {
      params: Promise.resolve({ id: "job-1" }),
    });

    expect(jobQueue.getProgress).toHaveBeenCalledWith("job-1");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pct: 60,
      message: "Rendering",
      status: "running",
      checkpointStep: "encode",
    });
  });
});

describe("job control API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["pause", pauseJob, "requestPause"],
    ["resume", resumeJob, "resume"],
  ] as const)(
    "maps %s queue results to success, not-found, and conflict responses",
    async (_operation, handler, method) => {
      jobQueue[method].mockResolvedValueOnce({ ok: true });
      const success = await handler(new Request("http://localhost"), {
        params: Promise.resolve({ id: "job-1" }),
      });
      expect(success.status).toBe(200);
      await expect(success.json()).resolves.toEqual({ ok: true });

      jobQueue[method].mockResolvedValueOnce({
        ok: false,
        code: "not_found",
        message: "Job not found",
      });
      const missing = await handler(new Request("http://localhost"), {
        params: Promise.resolve({ id: "missing" }),
      });
      expect(missing.status).toBe(404);

      jobQueue[method].mockResolvedValueOnce({
        ok: false,
        code: "conflict",
        message: "Invalid job state",
      });
      const conflict = await handler(new Request("http://localhost"), {
        params: Promise.resolve({ id: "job-1" }),
      });
      expect(conflict.status).toBe(409);
    },
  );

  it("cancels an existing active job and reports missing or terminal jobs", async () => {
    jobQueue.getJob.mockReturnValueOnce({ id: "job-1" });
    jobQueue.cancel.mockResolvedValueOnce("aborting");
    const success = await cancelJob(new Request("http://localhost"), {
      params: Promise.resolve({ id: "job-1" }),
    });
    expect(success.status).toBe(200);
    await expect(success.json()).resolves.toEqual({
      ok: true,
      result: "aborting",
    });

    jobQueue.getJob.mockReturnValueOnce(undefined);
    const missing = await cancelJob(new Request("http://localhost"), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(missing.status).toBe(404);

    jobQueue.getJob.mockReturnValueOnce({ id: "done" });
    jobQueue.cancel.mockResolvedValueOnce("noop");
    const terminal = await cancelJob(new Request("http://localhost"), {
      params: Promise.resolve({ id: "done" }),
    });
    expect(terminal.status).toBe(200);
    await expect(terminal.json()).resolves.toEqual({
      ok: true,
      result: "noop",
    });
  });

  it("validates and executes top or bottom moves", async () => {
    jobQueue.getJob.mockReturnValueOnce({ id: "job-1" });
    const success = await moveJob(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ to: "top" }),
      }),
      { params: Promise.resolve({ id: "job-1" }) },
    );
    expect(success.status).toBe(200);
    expect(jobQueue.move).toHaveBeenCalledWith("job-1", "top");

    const invalid = await moveJob(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ to: "middle" }),
      }),
      { params: Promise.resolve({ id: "job-1" }) },
    );
    expect(invalid.status).toBe(400);

    jobQueue.getJob.mockReturnValueOnce(undefined);
    const missing = await moveJob(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ to: "bottom" }),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(missing.status).toBe(404);
  });

  it("validates reorder payloads and maps queue validation errors", async () => {
    const success = await reorderJobs(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ orderedIds: ["job-2", "job-1"] }),
      }),
    );
    expect(success.status).toBe(200);
    expect(jobQueue.reorder).toHaveBeenCalledWith(["job-2", "job-1"]);

    const invalid = await reorderJobs(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ orderedIds: ["job-1", 2] }),
      }),
    );
    expect(invalid.status).toBe(400);

    jobQueue.reorder.mockRejectedValueOnce(new Error("Queue changed"));
    const conflict = await reorderJobs(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ orderedIds: ["job-1"] }),
      }),
    );
    expect(conflict.status).toBe(400);
    await expect(conflict.json()).resolves.toEqual({ error: "Queue changed" });
  });
});
