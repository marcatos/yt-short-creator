import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("FFmpeg VO and ASS render", () => {
  beforeEach(() => {
    childProcessMocks.spawn.mockReset();
    childProcessMocks.spawnSync.mockClear();
  });

  it("ducks source audio, mixes VO, and burns Windows ASS captions", async () => {
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
      candidateId: "candidate-vo",
      origin: "clip",
      sourceMediaPath: "C:/media/race.mp4",
      outputPath: "C:/out/short-it.mp4",
      startMs: 1_000,
      endMs: 9_000,
      logoPath: "C:/brand/logo.png",
      accentColor: "#E10600",
      voiceAssetPath: "C:/media/vo-it.mp3",
      assPath: "C:/media/captions-it.ass",
      burnInCaptions: true,
      voiceDuckDb: -12,
    });

    const args = childProcessMocks.spawn.mock.calls[0]?.[1] as string[];
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(args).toContain("C:/media/vo-it.mp3");
    expect(filter).toContain("[0:a]volume=0.251189[ga]");
    expect(filter).toContain("[2:a]volume=1[va]");
    expect(filter).toContain(
      "[ga][va]amix=inputs=2:duration=first:dropout_transition=0[aout]",
    );
    expect(filter).toContain(
      "ass=filename='C\\:/media/captions-it.ass'[outv]",
    );
    expect(args.slice(args.indexOf("-map"), args.indexOf("-map") + 4)).toEqual([
      "-map",
      "[outv]",
      "-map",
      "[aout]",
    ]);
  });

  it("burns ASS captions into generated shorts without game audio", async () => {
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
      candidateId: "candidate-generated",
      origin: "generate",
      sourceMediaPath: "C:/media/background.mp4",
      outputPath: "C:/out/generated-en.mp4",
      logoPath: "C:/brand/logo.png",
      accentColor: "#E10600",
      voiceAssetPath: "C:/media/generated-en.mp3",
      assPath: "C:/media/generated-en.ass",
      burnInCaptions: true,
      timeline: [
        {
          asset: "C:/media/background.mp4",
          startMs: 0,
          endMs: 8_000,
        },
      ],
    });

    const args = childProcessMocks.spawn.mock.calls[0]?.[1] as string[];
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain(
      "ass=filename='C\\:/media/generated-en.ass'[outv]",
    );
  });
});
