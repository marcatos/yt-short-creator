import { describe, expect, it } from "vitest";

import {
  parseYouTubeUploadLimitError,
  uploadLimitBackoffMs,
  YouTubeUploadLimitExceededError,
} from "@/src/domain/youtube-upload-limit";

describe("youtube upload limit", () => {
  it("uses stepped backoff capped at 6h", () => {
    expect(uploadLimitBackoffMs(1)).toBe(3_600_000);
    expect(uploadLimitBackoffMs(2)).toBe(7_200_000);
    expect(uploadLimitBackoffMs(3)).toBe(14_400_000);
    expect(uploadLimitBackoffMs(4)).toBe(21_600_000);
    expect(uploadLimitBackoffMs(99)).toBe(21_600_000);
  });

  it("parses uploadLimitExceeded reason from Google-shaped errors", () => {
    const error = {
      message: "Request failed",
      errors: [{ reason: "uploadLimitExceeded" }],
    };
    const parsed = parseYouTubeUploadLimitError(error, 2);
    expect(parsed).toBeInstanceOf(YouTubeUploadLimitExceededError);
    expect(parsed?.attempt).toBe(2);
  });

  it("parses the known message text", () => {
    const parsed = parseYouTubeUploadLimitError(
      new Error("The user has exceeded the number of videos they may upload."),
    );
    expect(parsed).toBeInstanceOf(YouTubeUploadLimitExceededError);
  });

  it("returns null for unrelated errors", () => {
    expect(parseYouTubeUploadLimitError(new Error("quotaExceeded"))).toBeNull();
  });
});
