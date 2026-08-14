import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFsHardwareConfig } from "@/src/adapters/config/fs-hardware-config";
import { DEFAULT_HARDWARE } from "@/src/domain/hardware";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempConfigPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yt-hardware-"));
  tempDirs.push(dir);
  return path.join(dir, "hardware.json");
}

describe("createFsHardwareConfig", () => {
  it("returns defaults when the config file is missing", async () => {
    const hardware = createFsHardwareConfig({ configPath: tempConfigPath() });
    await expect(hardware.get()).resolves.toEqual(DEFAULT_HARDWARE);
  });

  it("persists saved hardware and reads it back", async () => {
    const configPath = tempConfigPath();
    const hardware = createFsHardwareConfig({ configPath });
    const next = {
      ...DEFAULT_HARDWARE,
      gpu: "NVIDIA GeForce RTX 5090",
      buttonBox: "",
    };

    await hardware.save(next);

    await expect(hardware.get()).resolves.toEqual(next);
    expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual(next);
  });
});
