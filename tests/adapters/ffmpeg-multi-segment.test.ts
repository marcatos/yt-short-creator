import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

vi.mock("node:child_process", () => childProcessMocks);

import { createFfmpegRender } from "@/src/adapters/ffmpeg/ffmpeg-render";
import type { Logger } from "@/src/ports/logger";

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

describe("ffmpeg multi-segment replay render", () => {
  beforeEach(() => {
    childProcessMocks.spawn.mockReset();
    childProcessMocks.spawnSync.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds concat filter_complex for multi-segment shorts", async () => {
    const child = new FakeChildProcess();
    childProcessMocks.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });

    const render = createFfmpegRender({
      logger: logger(),
      videoEncoderPreference: "libx264",
    });

    await render.render({
      candidateId: "c1",
      origin: "replay",
      sourceMediaPath: "C:/videos/race.mkv",
      outputPath: "C:/out/c1.mp4",
      startMs: 0,
      endMs: 30_000,
      segments: [
        { startMs: 1_000, endMs: 8_000 },
        { startMs: 20_000, endMs: 28_000 },
      ],
      logoPath: "C:/brand/logo.png",
      accentColor: "#E10600",
    });

    expect(childProcessMocks.spawn).toHaveBeenCalled();
    const renderCall = childProcessMocks.spawn.mock.calls.find(
      (call) =>
        Array.isArray(call[1]) &&
        (call[1] as string[]).includes("-filter_complex"),
    );
    const args = renderCall?.[1] as string[];
    expect(args).toBeDefined();
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("concat=n=2:v=1:a=0");
    expect(filter).toContain("concat=n=2:v=0:a=1");
    expect(args.filter((value) => value === "C:/videos/race.mkv")).toHaveLength(
      2,
    );
  });
});
