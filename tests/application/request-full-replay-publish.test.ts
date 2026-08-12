import { describe, expect, it } from "vitest";

import { createRequestFullReplayPublish } from "@/src/application/request-full-replay-publish";
import type { ReplaySession } from "@/src/domain/entities";
import type { Logger } from "@/src/ports/logger";

const now = new Date("2026-08-12T18:00:00.000Z");

function logger(): Logger {
  const instance: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child: () => instance,
  };
  return instance;
}

describe("requestFullReplayPublish", () => {
  it("enqueues publish_full_replay when racePackage exists", async () => {
    const session: ReplaySession = {
      id: "session-1",
      rpyPath: null,
      ibtPath: null,
      mediaPath: "C:/Videos/race.mkv",
      trackName: "Oschersleben",
      focusCarIdx: null,
      title: "Race",
      durationSec: 1010,
      status: "ready",
      events: [],
      racePackage: {
        focusCarHint: "pi",
        transcript: "Gara",
        timeline: [],
        fullVideo: {
          title: "Titolo gara",
          description: "Desc",
          tags: ["iRacing"],
        },
        audioTranscript: "",
      },
      fullVideoEncodePath: null,
      fullVideoYoutubeId: null,
      fullVideoPrivacy: null,
      fullVideoPublishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const queued: Array<{ type: string; payload: Record<string, unknown> }> =
      [];
    const request = createRequestFullReplayPublish({
      replaySessions: {
        async save() {},
        async getById(id) {
          return id === session.id ? session : null;
        },
        async list() {
          return [session];
        },
      },
      queue: {
        async enqueue(job) {
          queued.push(job);
          return "job-1";
        },
        listJobs: () => [],
        async getProgress() {
          return null;
        },
      } as never,
      logger: logger(),
    });

    const result = await request({ sessionId: "session-1", privacy: "unlisted" });
    expect(result.jobId).toBe("job-1");
    expect(queued[0]).toMatchObject({
      type: "publish_full_replay",
      payload: { sessionId: "session-1", privacy: "unlisted" },
    });
  });
});
