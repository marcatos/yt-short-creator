import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

import {
  resetVideoEncoderCache,
  resolveVideoEncoder,
} from "@/src/adapters/ffmpeg/ffmpeg-encoder";

const ffmpegAvailable =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

describe.skipIf(!ffmpegAvailable)("resolveVideoEncoder", () => {
  it("prefers a working GPU encoder when available, else libx264", () => {
    resetVideoEncoderCache();
    const choice = resolveVideoEncoder("ffmpeg");
    expect(choice.codec).toMatch(/^(h264_nvenc|h264_amf|h264_qsv|h264_mf|libx264)$/);
    expect(choice.args[0]).toBe("-c:v");
    expect(choice.args[1]).toBe(choice.codec);
  });
});
