export type JobCheckpoint = {
  step: string;
  data?: unknown;
};

export class JobPausedError extends Error {
  readonly code = "JOB_PAUSED" as const;
  constructor(message = "Job paused") {
    super(message);
    this.name = "JobPausedError";
  }
}

export class JobCancelledError extends Error {
  readonly code = "JOB_CANCELLED" as const;
  constructor(message = "Job cancelled") {
    super(message);
    this.name = "JobCancelledError";
  }
}

export function isJobPausedError(error: unknown): error is JobPausedError {
  return error instanceof JobPausedError;
}

export function isJobCancelledError(error: unknown): error is JobCancelledError {
  return error instanceof JobCancelledError;
}

/** Ordered steps per job type (last completed step name stored in checkpoint). */
export const QUEUE_JOB_STEPS: Record<string, readonly string[]> = {
  sync_channel: ["run"],
  download_source_video: ["download"],
  analyze_clips: ["run"],
  analyze_replay: ["run"],
  ideate: ["run"],
  capture_replay: ["capture"],
  assemble_generate_preview: ["tts", "assemble"],
  render_short: ["prepare", "render", "enqueue_publish"],
  publish_short: ["prepare", "upload"],
};

export function checkpointReached(
  checkpoint: JobCheckpoint | null | undefined,
  step: string,
  jobType?: string,
): boolean {
  if (!checkpoint?.step) return false;
  const steps =
    (jobType && QUEUE_JOB_STEPS[jobType]) ||
    Object.values(QUEUE_JOB_STEPS).find((list) => list.includes(step));
  if (!steps) {
    return checkpoint.step === step;
  }
  const doneIdx = steps.indexOf(checkpoint.step);
  const needIdx = steps.indexOf(step);
  if (doneIdx < 0 || needIdx < 0) return checkpoint.step === step;
  return doneIdx >= needIdx;
}
