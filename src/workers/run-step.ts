import { checkpointReached } from "@/src/domain/queue-control";

import type { JobHandlerContext } from "./job-handler-context";

/**
 * Runs one idempotent step of a multi-step handler.
 *
 * Skips `fn` entirely if the job's checkpoint shows this step (or a later
 * one) already completed. Otherwise runs `fn`, persists the checkpoint, then
 * re-checks for a pause/cancel request at the new step boundary.
 */
export async function runStep(
  ctx: JobHandlerContext,
  jobType: string,
  step: string,
  fn: () => Promise<void>,
): Promise<void> {
  ctx.throwIfPausedOrCancelled();
  if (checkpointReached(ctx.checkpoint, step, jobType)) {
    return;
  }
  await fn();
  await ctx.saveCheckpoint(step);
  ctx.throwIfPausedOrCancelled();
}
