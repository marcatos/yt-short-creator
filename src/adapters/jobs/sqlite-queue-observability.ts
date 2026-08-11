import type { JobRecord } from "@/src/adapters/jobs/job-record";
import {
  persistJob,
  readNextQueuedJob,
  type Queryable,
} from "@/src/adapters/jobs/sqlite-queue-storage";
import type { Logger } from "@/src/ports/logger";

export function readQueuedForClaim(
  db: Queryable,
  logger: Logger,
): JobRecord | undefined {
  const startedAt = Date.now();
  try {
    return readNextQueuedJob(db);
  } catch (error) {
    logDatabaseFailure(logger, "Job claim query failed", error, {
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export function persistJobWithLogging(
  db: Queryable,
  logger: Logger,
  job: JobRecord,
  operation: string,
): void {
  const startedAt = Date.now();
  try {
    persistJob(db, job);
  } catch (error) {
    logDatabaseFailure(logger, "Job persistence failed", error, {
      jobId: job.id,
      type: job.type,
      operation,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

function logDatabaseFailure(
  logger: Logger,
  message: string,
  error: unknown,
  context: Record<string, unknown>,
): void {
  logger.error(message, {
    ...context,
    errorMessage: error instanceof Error ? error.message : String(error),
    errorStack: error instanceof Error ? error.stack : undefined,
  });
}
