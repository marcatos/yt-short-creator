import { describe, expect, it } from "vitest";

import { shouldEnqueueInspirationSync } from "@/src/application/schedule-inspiration-sync";

describe("shouldEnqueueInspirationSync", () => {
  const intervalHours = 24;
  const now = new Date("2026-08-14T12:00:00.000Z");

  it("returns true when last ok sync was longer ago than the interval", () => {
    const latestOkSyncAt = new Date("2026-08-13T11:00:00.000Z");
    expect(
      shouldEnqueueInspirationSync({ latestOkSyncAt, now, intervalHours }),
    ).toBe(true);
  });

  it("returns false when last ok sync was within the interval", () => {
    const latestOkSyncAt = new Date("2026-08-14T11:00:00.000Z");
    expect(
      shouldEnqueueInspirationSync({ latestOkSyncAt, now, intervalHours }),
    ).toBe(false);
  });

  it("returns true when there has never been an ok sync", () => {
    expect(
      shouldEnqueueInspirationSync({
        latestOkSyncAt: null,
        now,
        intervalHours,
      }),
    ).toBe(true);
  });
});
