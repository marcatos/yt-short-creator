import { describe, it, expect } from "vitest";
import { applyCandidateEvent } from "@/src/domain/approval";
import type { ShortCandidate } from "@/src/domain/entities";
import type { CandidateStatus } from "@/src/domain/status";

function candidate(status: CandidateStatus): ShortCandidate {
  return {
    id: "c1",
    origin: "clip",
    status,
    title: "Test",
    description: "",
    tags: [],
    score: 0.9,
    provenance: {
      sourceVideoId: "v1",
      startMs: 0,
      endMs: 10000,
      hookReason: "x",
      crop: { mode: "center_vertical", focusX: 0.5 },
    },
    renderOutputPath:
      status === "failed" || status === "ready" || status === "publishing"
        ? "media/renders/c1.mp4"
        : null,
    scheduledAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("ShortCandidate status transitions", () => {
  it("proposed → revising on request_revision", () => {
    const next = applyCandidateEvent(candidate("proposed"), {
      type: "request_revision",
    });
    expect(next.status).toBe("revising");
  });

  it("revising → proposed on revision_ready", () => {
    const next = applyCandidateEvent(candidate("revising"), {
      type: "revision_ready",
    });
    expect(next.status).toBe("proposed");
  });

  it("proposed → rejected on reject", () => {
    const next = applyCandidateEvent(candidate("proposed"), {
      type: "reject",
    });
    expect(next.status).toBe("rejected");
  });

  it("proposed → approved on approve", () => {
    const next = applyCandidateEvent(candidate("proposed"), {
      type: "approve",
    });
    expect(next.status).toBe("approved");
  });

  it("approved → rendering on enqueue_render", () => {
    const next = applyCandidateEvent(candidate("approved"), {
      type: "enqueue_render",
    });
    expect(next.status).toBe("rendering");
  });

  it("rendering → ready on render_succeeded", () => {
    const next = applyCandidateEvent(candidate("rendering"), {
      type: "render_succeeded",
    });
    expect(next.status).toBe("ready");
  });

  it("rendering → failed on render_failed", () => {
    const next = applyCandidateEvent(candidate("rendering"), {
      type: "render_failed",
    });
    expect(next.status).toBe("failed");
  });

  it("ready → publishing on mark_publishing", () => {
    const next = applyCandidateEvent(candidate("ready"), {
      type: "mark_publishing",
    });
    expect(next.status).toBe("publishing");
  });

  it("publishing → published on publish_succeeded", () => {
    const next = applyCandidateEvent(candidate("publishing"), {
      type: "publish_succeeded",
    });
    expect(next.status).toBe("published");
  });

  it("publishing → failed on publish_failed", () => {
    const next = applyCandidateEvent(candidate("publishing"), {
      type: "publish_failed",
    });
    expect(next.status).toBe("failed");
  });

  it("failed → rendering on retry_render", () => {
    const next = applyCandidateEvent(candidate("failed"), {
      type: "retry_render",
    });
    expect(next.status).toBe("rendering");
  });

  it("failed → publishing on retry_upload", () => {
    const next = applyCandidateEvent(candidate("failed"), {
      type: "retry_upload",
    });
    expect(next.status).toBe("publishing");
  });

  it("rejects invalid transition from published", () => {
    expect(() =>
      applyCandidateEvent(candidate("published"), { type: "approve" }),
    ).toThrow();
  });

  it("rejects invalid transition from rejected", () => {
    expect(() =>
      applyCandidateEvent(candidate("rejected"), { type: "approve" }),
    ).toThrow();
  });
});
