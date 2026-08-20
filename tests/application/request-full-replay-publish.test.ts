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

function replaySession(): ReplaySession {
  return {
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
}

function makeRequest(options: {
  session: ReplaySession;
  queued: Array<{ type: string; payload: Record<string, unknown> }>;
  existingJobs?: Array<{
    id: string;
    type: string;
    status: string;
    payload: Record<string, unknown>;
  }>;
}) {
  return createRequestFullReplayPublish({
    replaySessions: {
      async save() {},
      async getById(id) {
        return id === options.session.id ? options.session : null;
      },
      async list() {
        return [options.session];
      },
    },
    queue: {
      async enqueue(job: { type: string; payload: Record<string, unknown> }) {
        options.queued.push(job);
        return `job-${options.queued.length}`;
      },
      listJobs: () => options.existingJobs ?? [],
      async getProgress() {
        return null;
      },
    } as never,
    logger: logger(),
  });
}

describe("requestFullReplayPublish", () => {
  it("enqueues a voice-over publish job distinct from the plain one", async () => {
    const queued: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const request = makeRequest({
      session: replaySession(),
      queued,
      existingJobs: [
        {
          id: "job-plain",
          type: "publish_full_replay",
          status: "running",
          payload: { sessionId: "session-1", privacy: "unlisted" },
        },
      ],
    });

    const result = await request({
      sessionId: "session-1",
      privacy: "unlisted",
      voiceOver: true,
    });

    expect(result.jobId).toBe("job-1");
    expect(queued).toEqual([
      {
        type: "publish_full_replay",
        payload: {
          sessionId: "session-1",
          privacy: "unlisted",
          voiceOver: true,
          scheduledAt: null,
        },
      },
    ]);
  });

  it("reuses an in-flight voice-over job instead of enqueuing a duplicate", async () => {
    const queued: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const request = makeRequest({
      session: replaySession(),
      queued,
      existingJobs: [
        {
          id: "job-vo",
          type: "publish_full_replay",
          status: "paused",
          payload: {
            sessionId: "session-1",
            privacy: "unlisted",
            voiceOver: true,
          },
        },
      ],
    });

    const result = await request({ sessionId: "session-1", voiceOver: true });

    expect(result.jobId).toBe("job-vo");
    expect(queued).toEqual([]);
  });

  it("does not reuse a voice-over job for a plain publish request", async () => {
    const queued: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const request = makeRequest({
      session: replaySession(),
      queued,
      existingJobs: [
        {
          id: "job-vo",
          type: "publish_full_replay",
          status: "queued",
          payload: {
            sessionId: "session-1",
            privacy: "unlisted",
            voiceOver: true,
          },
        },
      ],
    });

    await request({ sessionId: "session-1" });

    expect(queued).toEqual([
      {
        type: "publish_full_replay",
        payload: {
          sessionId: "session-1",
          privacy: "unlisted",
          voiceOver: false,
          scheduledAt: null,
        },
      },
    ]);
  });

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
        async enqueue(job: { type: string; payload: Record<string, unknown> }) {
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
      payload: {
        sessionId: "session-1",
        privacy: "unlisted",
        scheduledAt: null,
      },
    });
  });

  it("passes scheduledAt ISO into the job payload", async () => {
    const queued: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const request = makeRequest({
      session: replaySession(),
      queued,
    });
    const scheduledAt = new Date("2026-08-21T06:30:00.000Z");
    await request({
      sessionId: "session-1",
      privacy: "public",
      voiceOver: true,
      scheduledAt,
    });
    expect(queued[0]).toEqual({
      type: "publish_full_replay",
      payload: {
        sessionId: "session-1",
        privacy: "public",
        voiceOver: true,
        scheduledAt: "2026-08-21T06:30:00.000Z",
      },
    });
  });
});
