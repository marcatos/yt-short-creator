import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAttachReplayMedia } from "@/src/application/attach-replay-media";
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
    mediaPath: "C:/Videos/old.mkv",
    commentaryPath: null,
    commentaryOffsetMs: 0,
    trackName: "Oschersleben",
    focusCarIdx: null,
    title: "Race",
    durationSec: 1010,
    status: "ready",
    events: [],
    racePackage: null,
    raceAnalysis: {
      focusCarHint: "focus",
      context: {
        simulator: null,
        track: "Oschersleben",
        car: "GR86",
        durationSec: 1010,
      },
      results: {},
      recurringRivals: [],
      events: [],
      storylines: [],
      shortScores: [],
      hudTimeline: [],
      commentaryMarkers: [],
    },
    fullVideoEncodePath: "C:/encode.mp4",
    fullVideoYoutubeId: null,
    fullVideoPrivacy: null,
    fullVideoPublishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("attachReplayMedia", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("clears derived artefacts when media path changes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "attach-media-"));
    dirs.push(dir);
    const newMedia = path.join(dir, "new.mkv");
    await fs.writeFile(newMedia, "fake");

    const sessions = new MemorySessions(baseSession());
    const attach = createAttachReplayMedia({
      replaySessions: sessions,
      mediaDuration: { probeDurationSec: async () => 932 },
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

    const updated = await attach({ sessionId: "rs-1", mediaPath: newMedia });

    expect(updated.mediaPath).toBe(newMedia);
    expect(updated.durationSec).toBe(932);
    expect(updated.trackName).toBeNull();
    expect(updated.raceAnalysis).toBeNull();
    expect(updated.fullVideoEncodePath).toBeNull();
  });
});
