import { describe, expect, it } from "vitest";

import {
  isDedicatedWorkerProcess,
  workersEmbeddedInNextEnabled,
} from "@/src/lib/worker-mode";

describe("worker-mode", () => {
  it("keeps workers out of Next by default", () => {
    expect(workersEmbeddedInNextEnabled({})).toBe(false);
    expect(workersEmbeddedInNextEnabled({ WORKERS_IN_NEXT: "" })).toBe(false);
  });

  it("allows an explicit Next embed escape hatch", () => {
    expect(workersEmbeddedInNextEnabled({ WORKERS_IN_NEXT: "1" })).toBe(true);
    expect(workersEmbeddedInNextEnabled({ WORKERS_IN_NEXT: "true" })).toBe(
      true,
    );
  });

  it("detects the dedicated worker process flag", () => {
    expect(isDedicatedWorkerProcess({})).toBe(false);
    expect(isDedicatedWorkerProcess({ WORKER_PROCESS: "1" })).toBe(true);
  });
});
