import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFsMediaStore } from "@/src/adapters/media/fs-media-store";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("createFsMediaStore", () => {
  it("resolves paths under MEDIA_ROOT subdirectories", () => {
    const mediaRoot = path.join(os.tmpdir(), "yt-short-creator-media-test");
    const mediaStore = createFsMediaStore({ mediaRoot });

    expect(mediaStore.sourcePath("abc123")).toBe(
      path.join(mediaRoot, "sources", "abc123.mp4"),
    );
    expect(mediaStore.renderPath("cand-1")).toBe(
      path.join(mediaRoot, "renders", "cand-1.mp4"),
    );
    expect(mediaStore.voRenderPath?.("cand-1", "it")).toBe(
      path.join(mediaRoot, "renders", "cand-1", "vo-it.mp4"),
    );
    expect(mediaStore.voRenderPath?.("cand-1", "en")).toBe(
      path.join(mediaRoot, "renders", "cand-1", "vo-en.mp4"),
    );
    expect(mediaStore.voRenderPath?.("cand-1", "it")).not.toBe(
      mediaStore.voRenderPath?.("cand-1", "en"),
    );
    expect(mediaStore.audioPath("cand-1")).toBe(
      path.join(mediaRoot, "audio", "cand-1.mp3"),
    );
    expect(mediaStore.voPath?.("cand-1", "it")).toBe(
      path.join(mediaRoot, "voice-overs", "cand-1", "vo-it.mp3"),
    );
    expect(mediaStore.brollPath("../escape.mp4")).toBe(
      path.join(mediaRoot, "broll", "escape.mp4"),
    );
    expect(mediaStore.replayAnalysisDir("session-1")).toBe(
      path.join(mediaRoot, "replays", "session-1"),
    );
    expect(mediaStore.fullReplayEncodePath("session-1")).toBe(
      path.join(mediaRoot, "replays", "session-1", "full-youtube.mp4"),
    );
  });

  it("creates sources, renders, audio, broll, and replays directories", async () => {
    const mediaRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "yt-short-creator-media-"),
    );
    tempDirs.push(mediaRoot);

    const mediaStore = createFsMediaStore({ mediaRoot });
    await mediaStore.ensureDirs();
    const captionPath = path.join(mediaRoot, "voice-overs", "cand-1", "vo-it.srt");
    await mediaStore.writeText?.(captionPath, "caption");

    expect(fs.existsSync(path.join(mediaRoot, "sources"))).toBe(true);
    expect(fs.existsSync(path.join(mediaRoot, "renders"))).toBe(true);
    expect(fs.existsSync(path.join(mediaRoot, "audio"))).toBe(true);
    expect(fs.existsSync(path.join(mediaRoot, "voice-overs"))).toBe(true);
    expect(fs.existsSync(path.join(mediaRoot, "broll"))).toBe(true);
    expect(fs.existsSync(path.join(mediaRoot, "replays"))).toBe(true);
    expect(fs.readFileSync(captionPath, "utf8")).toBe("caption");
  });
});
