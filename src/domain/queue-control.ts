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
  // The handler only checkpoints a single "assemble" step (TTS + assembly
  // run atomically); this list must match handlers.ts exactly.
  assemble_generate_preview: ["assemble"],
  render_short: ["prepare", "render", "enqueue_publish"],
  publish_short: ["prepare", "upload"],
  publish_full_replay: ["encode", "upload"],
};

function compareSteps(
  steps: readonly string[],
  doneStep: string,
  step: string,
): boolean {
  const doneIdx = steps.indexOf(doneStep);
  const needIdx = steps.indexOf(step);
  if (doneIdx < 0 || needIdx < 0) return doneStep === step;
  return doneIdx >= needIdx;
}

export function checkpointReached(
  checkpoint: JobCheckpoint | null | undefined,
  step: string,
  jobType?: string,
): boolean {
  if (!checkpoint?.step) return false;

  if (jobType !== undefined) {
    // jobType is explicit (the only way real handlers call this): never
    // guess across unrelated job types' step lists. If jobType isn't a
    // recognized key (config/typo bug), treat the step as not reached so an
    // idempotent handler safely re-runs it instead of silently skipping it.
    const steps = QUEUE_JOB_STEPS[jobType];
    return steps ? compareSteps(steps, checkpoint.step, step) : false;
  }

  const steps = Object.values(QUEUE_JOB_STEPS).find((list) =>
    list.includes(step),
  );
  if (!steps) {
    return checkpoint.step === step;
  }
  return compareSteps(steps, checkpoint.step, step);
}
