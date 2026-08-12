import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

vi.mock("node:child_process", () => childProcessMocks);

import { createFfmpegRender } from "@/src/adapters/ffmpeg/ffmpeg-render";
import { createYtdlpDownload } from "@/src/adapters/media/ytdlp-download";
import { JobCancelledError } from "@/src/domain/queue-control";
import type { Logger } from "@/src/ports/logger";
import type { MediaStorePort } from "@/src/ports/media-store";

class FakeChildProcess extends EventEmitter {
  readonly stderr = new PassThrough();
  readonly stdout = new PassThrough();
  readonly kill = vi.fn(() => true);
}

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

function fakeMediaStore(outputPath: string): MediaStorePort {
  return {
    ensureDirs: vi.fn(async () => undefined),
    sourcePath: vi.fn(() => outputPath),
    renderPath: vi.fn(),
    audioPath: vi.fn(),
    brollPath: vi.fn(),
    replayAnalysisDir: vi.fn(() => "C:/media/replays/x"),
    listBroll: vi.fn(async () => []),
  };
}

describe("media process cancellation", () => {
  beforeEach(() => {
    childProcessMocks.spawn.mockReset();
    childProcessMocks.spawnSync.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("kills FFmpeg and rejects with JobCancelledError on abort", async () => {
    const child = new FakeChildProcess();
    childProcessMocks.spawn.mockReturnValue(child);
    const controller = new AbortController();
    const outputPath = path.join(os.tmpdir(), "cancelled-render.mp4");
    const renderer = createFfmpegRender({
      logger: logger(),
      videoEncoderPreference: "libx264",
    });

    const rendering = renderer.render(
      {
        candidateId: "candidate-abort",
        origin: "clip",
        sourceMediaPath: "source.mp4",
        outputPath,
        startMs: 0,
        endMs: 1_000,
        logoPath: "logo.png",
        accentColor: "#E10600",
      },
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(childProcessMocks.spawn).toHaveBeenCalled());

    controller.abort();
    child.emit("close", null);

    await expect(rendering).rejects.toBeInstanceOf(JobCancelledError);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("kills yt-dlp and rejects with JobCancelledError on abort", async () => {
    const child = new FakeChildProcess();
    childProcessMocks.spawn.mockReturnValue(child);
    const controller = new AbortController();
    const outputPath = path.join(os.tmpdir(), "cancelled-download.mp4");
    const downloader = createYtdlpDownload({
      logger: logger(),
      mediaStore: fakeMediaStore(outputPath),
    });

    const downloading = downloader.download("video-id", {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(childProcessMocks.spawn).toHaveBeenCalled());

    controller.abort();
    child.emit("close", null);

    await expect(downloading).rejects.toBeInstanceOf(JobCancelledError);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
