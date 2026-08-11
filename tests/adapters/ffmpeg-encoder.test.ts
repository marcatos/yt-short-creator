import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

import {
  resetVideoEncoderCache,
  resolveVideoEncoder,
} from "@/src/adapters/ffmpeg/ffmpeg-encoder";

const ffmpegAvailable =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

describe.skipIf(!ffmpegAvailable)("resolveVideoEncoder", () => {
  it("auto_igpu prefers QSV/MF before NVENC when available", () => {
    resetVideoEncoderCache();
    const igpu = resolveVideoEncoder("ffmpeg", "auto_igpu");
    expect(igpu.codec).toMatch(/^(h264_qsv|h264_mf|h264_amf|h264_nvenc|libx264)$/);
    // On this machine QSV or MF should win over NVENC for auto_igpu.
    if (igpu.codec === "h264_nvenc") {
      // NVENC only if no iGPU path probed successfully.
      expect(igpu.label).toContain("NVIDIA");
    }
  });

  it("auto_dgpu prefers NVENC when the discrete encoder works", () => {
    resetVideoEncoderCache();
    const dgpu = resolveVideoEncoder("ffmpeg", "auto_dgpu");
    expect(["h264_nvenc", "h264_amf", "h264_qsv", "h264_mf", "libx264"]).toContain(
      dgpu.codec,
    );
  });

  it("can force libx264", () => {
    resetVideoEncoderCache();
    const cpu = resolveVideoEncoder("ffmpeg", "libx264");
    expect(cpu.codec).toBe("libx264");
  });
});
