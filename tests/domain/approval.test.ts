import { describe, it, expect } from "vitest";
import { applyCandidateEvent, assertCanPublish } from "@/src/domain/approval";
import type { ShortCandidate } from "@/src/domain/entities";

function base(): ShortCandidate {
  return {
    id: "c1",
    origin: "clip",
    status: "proposed",
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
    renderOutputPath: null,
    scheduledAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("applyCandidateEvent", () => {
  it("approves from proposed", () => {
    const next = applyCandidateEvent(base(), { type: "approve" });
    expect(next.status).toBe("approved");
  });

  it("rejects publishable check without ready+render", () => {
    expect(() =>
      applyCandidateEvent(base(), { type: "mark_publishing" }),
    ).toThrow();
  });
});

describe("assertCanPublish", () => {
  it("passes when status is ready", () => {
    expect(() =>
      assertCanPublish({ ...base(), status: "ready" }),
    ).not.toThrow();
  });

  it("throws when status is not ready", () => {
    expect(() => assertCanPublish(base())).toThrow();
  });

  it("blocks retry_upload without render artifact", () => {
    expect(() =>
      applyCandidateEvent(
        { ...base(), status: "failed", renderOutputPath: null, voiceOvers: null },
        { type: "retry_upload" },
      ),
    ).toThrow();
  });

  it("allows retry_upload when failed with a voice-over render artifact", () => {
    const next = applyCandidateEvent(
      {
        ...base(),
        status: "failed",
        renderOutputPath: null,
        voiceOvers: [
          {
            language: "it",
            script: "s",
            title: "t",
            description: "d",
            voiceProfile: "coral",
            audioPath: "a.mp3",
            words: [],
            srtPath: "a.srt",
            assPath: "a.ass",
            scriptHash: "h",
            renderOutputPath: "media/renders/vo-it.mp4",
          },
        ],
      },
      { type: "retry_upload" },
    );
    expect(next.status).toBe("publishing");
  });

  it("allows retry_upload when failed with render artifact", () => {
    const next = applyCandidateEvent(
      {
        ...base(),
        status: "failed",
        renderOutputPath: "media/renders/c1.mp4",
      },
      { type: "retry_upload" },
    );
    expect(next.status).toBe("publishing");
  });
});
