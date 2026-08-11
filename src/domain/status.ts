export const CANDIDATE_STATUSES = [
  "proposed",
  "revising",
  "approved",
  "rejected",
  "rendering",
  "ready",
  "publishing",
  "published",
  "failed",
] as const;

export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export type CandidateEvent =
  | { type: "approve" }
  | { type: "reject" }
  | { type: "request_revision" }
  | { type: "revision_ready" }
  | { type: "enqueue_render" }
  | { type: "render_succeeded" }
  | { type: "render_failed" }
  | { type: "mark_publishing" }
  | { type: "publish_succeeded" }
  | { type: "publish_failed" }
  | { type: "retry_render" }
  | { type: "retry_upload" };

const TRANSITIONS: Record<
  CandidateStatus,
  Partial<Record<CandidateEvent["type"], CandidateStatus>>
> = {
  proposed: {
    approve: "approved",
    reject: "rejected",
    request_revision: "revising",
  },
  revising: {
    revision_ready: "proposed",
  },
  approved: {
    enqueue_render: "rendering",
  },
  rejected: {},
  rendering: {
    render_succeeded: "ready",
    render_failed: "failed",
  },
  ready: {
    mark_publishing: "publishing",
  },
  publishing: {
    publish_succeeded: "published",
    publish_failed: "failed",
  },
  published: {},
  failed: {
    retry_render: "rendering",
    retry_upload: "publishing",
  },
};

export function nextStatus(
  current: CandidateStatus,
  event: CandidateEvent,
): CandidateStatus {
  const next = TRANSITIONS[current][event.type];
  if (!next) {
    throw new InvalidTransitionError(current, event.type);
  }
  return next;
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: CandidateStatus,
    public readonly event: CandidateEvent["type"],
  ) {
    super(`Invalid transition: ${from} + ${event}`);
    this.name = "InvalidTransitionError";
  }
}
