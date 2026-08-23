import { describe, expect, it, vi } from "vitest";

import { resolveVideoEncoderPreference } from "@/src/adapters/ffmpeg/resolve-video-encoder-preference";
import type { GamingActivityPort } from "@/src/ports/gaming-activity";
import type {
  AppSettings,
  SettingsRepository,
} from "@/src/ports/settings-repository";

function settingsRepo(
  videoEncoderPreference: AppSettings["videoEncoderPreference"],
): SettingsRepository {
  return {
    get: async () =>
      ({
        videoEncoderPreference,
      }) as Awaited<ReturnType<SettingsRepository["get"]>>,
    save: async () => {},
  };
}

function gamingPort(active: boolean): GamingActivityPort {
  return { isActive: async () => active };
}

describe("resolveVideoEncoderPreference", () => {
  it("maps auto to iGPU while gaming is active", async () => {
    const resolved = await resolveVideoEncoderPreference({
      settings: settingsRepo("auto"),
      gamingActivity: gamingPort(true),
    });
    expect(resolved).toEqual({
      configured: "auto",
      effective: "auto_igpu",
      gamingActive: true,
    });
  });

  it("maps auto to dGPU when idle", async () => {
    const resolved = await resolveVideoEncoderPreference({
      settings: settingsRepo("auto"),
      gamingActivity: gamingPort(false),
    });
    expect(resolved).toEqual({
      configured: "auto",
      effective: "auto_dgpu",
      gamingActive: false,
    });
  });

  it("passes through forced encoder preferences unchanged", async () => {
    const resolved = await resolveVideoEncoderPreference({
      settings: settingsRepo("h264_nvenc"),
      gamingActivity: gamingPort(true),
    });
    expect(resolved).toEqual({
      configured: "h264_nvenc",
      effective: "h264_nvenc",
      gamingActive: null,
    });
  });

  it("logs the gaming-aware resolution", async () => {
    const info = vi.fn();
    await resolveVideoEncoderPreference({
      settings: settingsRepo("auto"),
      gamingActivity: gamingPort(true),
      logger: { info } as never,
    });
    expect(info).toHaveBeenCalledWith(
      "Gaming-aware video encoder preference resolved",
      expect.objectContaining({
        configured: "auto",
        effective: "auto_igpu",
        gamingActive: true,
      }),
    );
  });
});
