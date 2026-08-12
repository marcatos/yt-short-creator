import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

vi.mock("node:child_process", () => childProcessMocks);

import { createFfmpegFullVoMix } from "@/src/adapters/ffmpeg/ffmpeg-full-vo-mix";
import type { Logger } from "@/src/ports/logger";

const tempDirs: string[] = [];

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

function succeedingSpawn(): void {
  childProcessMocks.spawn.mockImplementation(() => {
    const child = new FakeChildProcess();
    queueMicrotask(() => child.emit("close", 0));
    return child;
  });
}

function lastArgs(): string[] {
  const calls = childProcessMocks.spawn.mock.calls;
  return calls[calls.length - 1]?.[1] as string[];
}

beforeEach(() => {
  childProcessMocks.spawn.mockReset();
  childProcessMocks.spawnSync.mockClear();
});

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("FFmpeg full-race VO mix", () => {
  it("ducks the race audio under the voice-over and copies the video stream", async () => {
    succeedingSpawn();
    const mixer = createFfmpegFullVoMix({
      logger: logger(),
      videoEncoderPreference: "libx264",
    });

    const result = await mixer.mix({
      videoPath: "C:/media/full-youtube.mp4",
      voiceAudioPath: "C:/media/vo-it.mp3",
      outputPath: "C:/media/full-youtube-it.mp4",
      voiceDuckDb: -12,
    });

    const args = lastArgs();
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(args).toContain(path.resolve("C:/media/full-youtube.mp4"));
    expect(args).toContain(path.resolve("C:/media/vo-it.mp3"));
    expect(filter).toContain("[0:a]volume=0.251189[ga]");
    expect(filter).toContain("[1:a]volume=1[va]");
    expect(filter).toContain(
      "[ga][va]amix=inputs=2:duration=first:dropout_transition=0[aout]",
    );
    expect(args.slice(args.indexOf("-map"), args.indexOf("-map") + 4)).toEqual([
      "-map",
      "0:v",
      "-map",
      "[aout]",
    ]);
    expect(args).toContain("copy");
    expect(args).not.toContain("-vf");
    expect(result).toEqual({
      outputPath: path.resolve("C:/media/full-youtube-it.mp4"),
      burnedInCaptions: false,
      durationMs: expect.any(Number),
    });
  });

  it("burns soft captions into the video only when asked", async () => {
    succeedingSpawn();
    const mixer = createFfmpegFullVoMix({
      logger: logger(),
      videoEncoderPreference: "libx264",
    });

    const result = await mixer.mix({
      videoPath: "C:/media/full-youtube.mp4",
      voiceAudioPath: "C:/media/vo-en.mp3",
      outputPath: "C:/media/full-youtube-en.mp4",
      burnInCaptions: true,
      subtitlesPath: "C:/media/vo-en.srt",
    });

    const args = lastArgs();
    expect(args[args.indexOf("-vf") + 1]).toBe(
      "subtitles=filename='C\\:/media/vo-en.srt'",
    );
    expect(args).toContain("libx264");
    expect(args).not.toContain("copy");
    expect(result.burnedInCaptions).toBe(true);
  });

  it("keeps the copy path when burn-in is requested without a subtitle file", async () => {
    succeedingSpawn();
    const mixer = createFfmpegFullVoMix({
      logger: logger(),
      videoEncoderPreference: "libx264",
    });

    const result = await mixer.mix({
      videoPath: "C:/media/full-youtube.mp4",
      voiceAudioPath: "C:/media/vo-en.mp3",
      outputPath: "C:/media/full-youtube-en.mp4",
      burnInCaptions: true,
    });

    expect(lastArgs()).not.toContain("-vf");
    expect(result.burnedInCaptions).toBe(false);
  });

  it("concatenates voice-over chunks through a demuxer list without re-encoding", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "full-vo-concat-"));
    tempDirs.push(root);
    let listContent = "";
    childProcessMocks.spawn.mockImplementation((_cmd, args: string[]) => {
      const listPath = args[args.indexOf("-i") + 1]!;
      const child = new FakeChildProcess();
      void fs
        .readFile(listPath, "utf8")
        .then((content) => {
          listContent = content;
        })
        .finally(() => queueMicrotask(() => child.emit("close", 0)));
      return child;
    });
    const mixer = createFfmpegFullVoMix({ logger: logger() });

    const result = await mixer.concat({
      inputPaths: [
        path.join(root, "vo-it-part-1.mp3"),
        path.join(root, "vo-it-part-2.mp3"),
      ],
      outputPath: path.join(root, "vo-it.mp3"),
    });

    const args = lastArgs();
    expect(args.slice(args.indexOf("-f"), args.indexOf("-f") + 4)).toEqual([
      "-f",
      "concat",
      "-safe",
      "0",
    ]);
    expect(args).toContain("copy");
    expect(listContent).toContain("vo-it-part-1.mp3'");
    expect(listContent).toContain("vo-it-part-2.mp3'");
    expect(result.outputPath).toBe(path.join(root, "vo-it.mp3"));
    await expect(
      fs.access(path.join(root, "vo-it-concat.txt")),
    ).rejects.toThrow();
  });

  it("returns the single chunk untouched instead of spawning FFmpeg", async () => {
    succeedingSpawn();
    const mixer = createFfmpegFullVoMix({ logger: logger() });

    const result = await mixer.concat({
      inputPaths: ["C:/media/vo-it-part-1.mp3"],
      outputPath: "C:/media/vo-it.mp3",
    });

    expect(childProcessMocks.spawn).not.toHaveBeenCalled();
    expect(result.outputPath).toBe("C:/media/vo-it-part-1.mp3");
  });

  it("fails with FFmpeg stderr when the mix exits non-zero", async () => {
    childProcessMocks.spawn.mockImplementation(() => {
      const child = new FakeChildProcess();
      queueMicrotask(() => {
        child.stderr.write("Invalid data found");
        queueMicrotask(() => child.emit("close", 1));
      });
      return child;
    });
    const mixer = createFfmpegFullVoMix({
      logger: logger(),
      videoEncoderPreference: "libx264",
    });

    await expect(
      mixer.mix({
        videoPath: "C:/media/full-youtube.mp4",
        voiceAudioPath: "C:/media/vo-it.mp3",
        outputPath: "C:/media/full-youtube-it.mp4",
      }),
    ).rejects.toThrow(/Invalid data found/);
  });
});
