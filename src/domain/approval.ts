import type { ShortCandidate } from "./entities";
import {
  InvalidTransitionError,
  nextStatus,
  type CandidateEvent,
} from "./status";

export { InvalidTransitionError };
export type { CandidateEvent };

export class NotPublishableError extends Error {
  constructor(public readonly status: ShortCandidate["status"]) {
    super(`Candidate is not publishable in status "${status}"`);
    this.name = "NotPublishableError";
  }
}

export function assertCanPublish(candidate: ShortCandidate): void {
  if (candidate.status !== "ready") {
    throw new NotPublishableError(candidate.status);
  }
}

function assertCanRetryUpload(candidate: ShortCandidate): void {
  if (candidate.status !== "failed" || !candidate.renderOutputPath) {
    throw new NotPublishableError(candidate.status);
  }
}

export function applyCandidateEvent(
  candidate: ShortCandidate,
  event: CandidateEvent,
): ShortCandidate {
  if (event.type === "mark_publishing") {
    assertCanPublish(candidate);
  }
  if (event.type === "retry_upload") {
    assertCanRetryUpload(candidate);
  }

  const status = nextStatus(candidate.status, event);
  const updatedAt = new Date();
  if (event.type === "render_succeeded") {
    return { ...candidate, status, updatedAt };
  }
  return { ...candidate, status, updatedAt };
}
