/** YouTube per-channel daily upload limit (API reason uploadLimitExceeded). */

export const YOUTUBE_DAILY_UPLOAD_LIMIT_REASON = "youtube_daily_upload_limit";

export class YouTubeUploadLimitExceededError extends Error {
  readonly name = "YouTubeUploadLimitExceededError";
  readonly retryAfter: Date;
  readonly attempt: number;

  constructor(input?: { retryAfter?: Date; attempt?: number; message?: string }) {
    super(
      input?.message ??
        "The user has exceeded the number of videos they may upload.",
    );
    this.retryAfter = input?.retryAfter ?? defaultRetryAfter(input?.attempt ?? 1);
    this.attempt = input?.attempt ?? 1;
  }
}

export function isYouTubeUploadLimitExceededError(
  error: unknown,
): error is YouTubeUploadLimitExceededError {
  return error instanceof YouTubeUploadLimitExceededError;
}

/** Delay before next attempt after a limit hit (attempt is 1-based). */
export function uploadLimitBackoffMs(attempt: number): number {
  const step = Math.max(1, Math.floor(attempt));
  if (step <= 1) return 60 * 60 * 1000;
  if (step === 2) return 2 * 60 * 60 * 1000;
  if (step === 3) return 4 * 60 * 60 * 1000;
  return 6 * 60 * 60 * 1000;
}

export function defaultRetryAfter(attempt: number, now = new Date()): Date {
  return new Date(now.getTime() + uploadLimitBackoffMs(attempt));
}

/**
 * Map Google/YouTube client errors to a typed daily-limit error, or null.
 */
export function parseYouTubeUploadLimitError(
  error: unknown,
  attempt = 1,
): YouTubeUploadLimitExceededError | null {
  if (error instanceof YouTubeUploadLimitExceededError) {
    return error;
  }
  const reason = extractGoogleErrorReason(error);
  const message = error instanceof Error ? error.message : String(error);
  const matched =
    reason === "uploadLimitExceeded" ||
    /exceeded the number of videos they may upload/i.test(message) ||
    /daily upload limit/i.test(message);
  if (!matched) return null;
  return new YouTubeUploadLimitExceededError({ attempt, message });
}

function extractGoogleErrorReason(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const withResponse = error as {
    errors?: Array<{ reason?: string }>;
    response?: { data?: { error?: { errors?: Array<{ reason?: string }> } } };
  };
  const nested = withResponse.response?.data?.error?.errors?.[0]?.reason;
  if (nested) return nested;
  return withResponse.errors?.[0]?.reason;
}

export type YoutubeDailyUploadLimitCheckpoint = {
  reason: typeof YOUTUBE_DAILY_UPLOAD_LIMIT_REASON;
  retryAfter: string;
  attempt: number;
};

export function isYoutubeDailyUploadLimitCheckpoint(
  data: unknown,
): data is YoutubeDailyUploadLimitCheckpoint {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  return (
    record.reason === YOUTUBE_DAILY_UPLOAD_LIMIT_REASON &&
    typeof record.retryAfter === "string" &&
    typeof record.attempt === "number"
  );
}

export function youtubeDailyUploadLimitCheckpoint(
  attempt: number,
  retryAfter: Date,
): YoutubeDailyUploadLimitCheckpoint {
  return {
    reason: YOUTUBE_DAILY_UPLOAD_LIMIT_REASON,
    retryAfter: retryAfter.toISOString(),
    attempt,
  };
}
