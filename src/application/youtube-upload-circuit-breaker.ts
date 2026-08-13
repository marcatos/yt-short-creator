import {
  defaultRetryAfter,
  type YoutubeDailyUploadLimitCheckpoint,
} from "@/src/domain/youtube-upload-limit";

export type YoutubeUploadCircuitBreaker = {
  isBlocked(now?: Date): boolean;
  blockedUntil(): Date | null;
  currentAttempt(): number;
  recordLimitHit(attempt?: number, now?: Date): Date;
  recordSuccess(): void;
  /** Re-arm from durable checkpoints after process restart. */
  restoreBlockedUntil(until: Date, attempt: number, now?: Date): void;
  /** True when a publish job may be claimed/started. */
  shouldClaimPublishJob(now?: Date): boolean;
};

/**
 * Process-local breaker shared by all publish workers in this process.
 * Job checkpoints remain the durable source of truth across restarts.
 */
export function createYoutubeUploadCircuitBreaker(): YoutubeUploadCircuitBreaker {
  let blockedUntil: Date | null = null;
  let attempt = 0;

  return {
    isBlocked(now = new Date()) {
      if (!blockedUntil) return false;
      if (now.getTime() >= blockedUntil.getTime()) {
        blockedUntil = null;
        return false;
      }
      return true;
    },
    blockedUntil() {
      return blockedUntil;
    },
    currentAttempt() {
      return attempt;
    },
    recordLimitHit(nextAttempt, now = new Date()) {
      attempt = nextAttempt ?? attempt + 1;
      if (attempt < 1) attempt = 1;
      blockedUntil = defaultRetryAfter(attempt, now);
      return blockedUntil;
    },
    recordSuccess() {
      blockedUntil = null;
      attempt = 0;
    },
    restoreBlockedUntil(until, nextAttempt, now = new Date()) {
      if (until.getTime() <= now.getTime()) return;
      attempt = Math.max(1, nextAttempt);
      if (!blockedUntil || until.getTime() > blockedUntil.getTime()) {
        blockedUntil = until;
      }
    },
    shouldClaimPublishJob(now = new Date()) {
      return !this.isBlocked(now);
    },
  };
}

/** Module singleton used by workers in this process. */
export const youtubeUploadCircuitBreaker = createYoutubeUploadCircuitBreaker();

export function retryAfterFromCheckpoint(
  checkpoint: YoutubeDailyUploadLimitCheckpoint,
): Date {
  return new Date(checkpoint.retryAfter);
}
