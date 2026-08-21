import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAttachReplayCommentary } from "@/src/application/attach-replay-media";
import type { ReplaySession } from "@/src/domain/entities";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";

class MemorySessions implements ReplaySessionRepository {
  constructor(public session: ReplaySession) {}
  async save(session: ReplaySession) {
    this.session = session;
  }
  async getById(id: string) {
    return id === this.session.id ? this.session : null;
  }
  async list() {
    return [this.session];
  }
}

function baseSession(): ReplaySession {
  const now = new Date("2026-08-21T10:00:00.000Z");
  return {
    id: "rs-1",
    rpyPath: null,
    ibtPath: null,
    mediaPath: "C:/Videos/race.mkv",
    commentaryPath: null,
    commentaryOffsetMs: 0,
    trackName: null,
    focusCarIdx: null,
    title: "Race",
    durationSec: 600,
    status: "ready",
    events: [],
    racePackage: null,
    raceAnalysis: null,
    fullVideoEncodePath: null,
    fullVideoYoutubeId: null,
    fullVideoPrivacy: null,
    fullVideoPublishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("attachReplayCommentary", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("saves commentary path and offset", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "commentary-"));
    dirs.push(dir);
    const commentaryPath = path.join(dir, "comment.wav");
    await fs.writeFile(commentaryPath, "fake");

    const sessions = new MemorySessions(baseSession());
    const attach = createAttachReplayCommentary({
      replaySessions: sessions,
      clock: { now: () => new Date("2026-08-21T11:00:00.000Z") },
      logger: {
        debug() {},
        info() {},
        warn() {},
        error() {},
        child() {
          return this;
        },
      },
    });

    const updated = await attach({
      sessionId: "rs-1",
      commentaryPath,
      offsetMs: 12_500,
    });

    expect(updated.commentaryPath).toBe(commentaryPath);
    expect(updated.commentaryOffsetMs).toBe(12_500);
    expect(sessions.session.commentaryOffsetMs).toBe(12_500);
  });

  it("rejects missing commentary file", async () => {
    const sessions = new MemorySessions(baseSession());
    const attach = createAttachReplayCommentary({
      replaySessions: sessions,
      clock: { now: () => new Date() },
      logger: {
        debug() {},
        info() {},
        warn() {},
        error() {},
        child() {
          return this;
        },
      },
    });

    await expect(
      attach({
        sessionId: "rs-1",
        commentaryPath: "C:/missing/comment.wav",
      }),
    ).rejects.toThrow();
  });
});
