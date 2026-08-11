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
});
