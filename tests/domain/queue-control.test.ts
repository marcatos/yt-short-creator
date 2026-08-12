import { describe, expect, it } from "vitest";
import {
  JobCancelledError,
  JobPausedError,
  checkpointReached,
  isJobCancelledError,
  isJobPausedError,
} from "@/src/domain/queue-control";

describe("queue-control", () => {
  it("recognizes pause and cancel errors", () => {
    expect(isJobPausedError(new JobPausedError())).toBe(true);
    expect(isJobCancelledError(new JobCancelledError())).toBe(true);
    expect(isJobPausedError(new Error("nope"))).toBe(false);
  });

  it("checkpointReached is true only after listed step", () => {
    expect(checkpointReached(null, "prepare")).toBe(false);
    expect(checkpointReached({ step: "prepare" }, "prepare")).toBe(true);
    expect(checkpointReached({ step: "prepare" }, "render")).toBe(false);
    expect(checkpointReached({ step: "render" }, "prepare")).toBe(true);
    expect(checkpointReached({ step: "enqueue_publish" }, "render")).toBe(true);
  });

  it("never guesses across job types when jobType is explicit and unknown", () => {
    // A checkpoint step named "run" is shared by several job types
    // (sync_channel, analyze_clips, ...). With an unrecognized jobType we
    // must not fall back to an unrelated list and produce a false positive.
    expect(
      checkpointReached({ step: "run" }, "run", "not_a_real_job_type"),
    ).toBe(false);
  });

  it("still matches exactly by step name for a known jobType", () => {
    expect(checkpointReached({ step: "assemble" }, "assemble", "assemble_generate_preview")).toBe(true);
    expect(checkpointReached({ step: "run" }, "run", "sync_channel")).toBe(true);
  });

  it("orders caption upload after the Short video upload", () => {
    expect(
      checkpointReached({ step: "upload" }, "captions", "publish_short"),
    ).toBe(false);
    expect(
      checkpointReached({ step: "captions" }, "upload", "publish_short"),
    ).toBe(true);
  });
});
