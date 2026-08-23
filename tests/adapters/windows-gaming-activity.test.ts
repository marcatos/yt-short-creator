import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWindowsGamingActivity,
  IRACING_SIM_STATUS_URL,
} from "@/src/adapters/system/windows-gaming-activity";

const { spawnSyncMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(() => ({ status: 0, stdout: "" })),
}));

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}));

describe("createWindowsGamingActivity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    spawnSyncMock.mockReset();
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "" });
  });

  it("detects an active iRacing sim session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        text: async () => "running:1",
      })),
    );

    const gaming = createWindowsGamingActivity({
      processNames: ["iRacingSim64"],
    });

    await expect(gaming.isActive()).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      IRACING_SIM_STATUS_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("falls back to configured process names when iRacing is idle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        text: async () => "running:0",
      })),
    );
    spawnSyncMock.mockImplementation((_cmd, args: string[]) => {
      if (args.some((arg) => arg.includes("acc.exe"))) {
        return { status: 0, stdout: '"acc.exe","1234","Console","1","99,999 K"\n' };
      }
      return { status: 0, stdout: "" };
    });

    const gaming = createWindowsGamingActivity({ processNames: ["acc"] });

    await expect(gaming.isActive()).resolves.toBe(true);
  });

  it("returns false when no gaming signals are present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    const gaming = createWindowsGamingActivity({ processNames: ["acc"] });

    await expect(gaming.isActive()).resolves.toBe(false);
  });
});
