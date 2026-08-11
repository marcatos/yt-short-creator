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

export function applyCandidateEvent(
  candidate: ShortCandidate,
  event: CandidateEvent,
): ShortCandidate {
  if (event.type === "mark_publishing") {
    assertCanPublish(candidate);
  }

  const status = nextStatus(candidate.status, event);
  return { ...candidate, status };
}
