import { describe, expect, it } from "vitest";

import { createYoutubeUploadCircuitBreaker } from "@/src/application/youtube-upload-circuit-breaker";

describe("youtube upload circuit breaker", () => {
  it("blocks until retryAfter then clears on success", () => {
    const breaker = createYoutubeUploadCircuitBreaker();
    const now = new Date("2026-08-13T12:00:00.000Z");
    const until = breaker.recordLimitHit(1, now);
    expect(until.toISOString()).toBe("2026-08-13T13:00:00.000Z");
    expect(breaker.isBlocked(now)).toBe(true);
    expect(breaker.shouldClaimPublishJob(now)).toBe(false);
    expect(breaker.isBlocked(new Date("2026-08-13T13:00:00.000Z"))).toBe(false);
    breaker.recordLimitHit(1, now);
    breaker.recordSuccess();
    expect(breaker.isBlocked(now)).toBe(false);
    expect(breaker.currentAttempt()).toBe(0);
  });
});
