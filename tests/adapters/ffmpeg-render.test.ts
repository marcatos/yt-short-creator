import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { createFfmpegRender } from "@/src/adapters/ffmpeg/ffmpeg-render";
import type { Logger } from "@/src/ports/logger";

const ffmpegAvailable =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
const tempDirs: string[] = [];

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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe.skipIf(!ffmpegAvailable)("FFmpeg render adapter", () => {
  it("renders a one-second 1080x1920 clip with the brand overlay", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-render-"));
    tempDirs.push(dir);
    const sourcePath = path.join(dir, "source.mp4");
    const logoPath = path.join(dir, "logo.png");
    const outputPath = path.join(dir, "output.mp4");

    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=320x240:d=1",
        "-c:v",
        "mpeg4",
        sourcePath,
      ],
      { stdio: "ignore" },
    );
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=white:s=100x50",
        "-frames:v",
        "1",
        "-update",
        "1",
        "-threads",
        "1",
        logoPath,
      ],
      { stdio: "ignore" },
    );

    const renderer = createFfmpegRender({ logger: logger() });
    const result = await renderer.render({
      candidateId: "candidate-1",
      origin: "clip",
      sourceMediaPath: sourcePath,
      outputPath,
      startMs: 0,
      endMs: 1_000,
      crop: { mode: "center_vertical", focusX: 0.5 },
      logoPath,
      accentColor: "#E10600",
    });

    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=width,height",
          "-of",
          "json",
          outputPath,
        ],
        { encoding: "utf8" },
      ),
    ) as { streams: Array<{ width: number; height: number }> };

    expect(result.outputPath).toBe(outputPath);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);
    expect(probe.streams[0]).toEqual({ width: 1080, height: 1920 });
  }, 30_000);
});
