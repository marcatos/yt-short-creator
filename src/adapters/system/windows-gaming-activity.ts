import { spawnSync } from "node:child_process";

import type { GamingActivityPort } from "@/src/ports/gaming-activity";
import type { Logger } from "@/src/ports/logger";

export const IRACING_SIM_STATUS_URL =
  "http://127.0.0.1:32034/get_sim_status?object=simStatus";

/** Sim / game processes that should steer FFmpeg to the iGPU. */
export const DEFAULT_GAMING_PROCESS_NAMES = [
  "iRacingSim64",
  "iRacingSim",
  "acc",
  "AssettoCorsa",
  "acs",
  "rf2",
  "rFactor2",
] as const;

function parseProcessNamesFromEnv(): string[] {
  const raw = process.env.GAMING_PROCESS_NAMES?.trim();
  if (!raw) return [...DEFAULT_GAMING_PROCESS_NAMES];
  return raw
    .split(",")
    .map((name) => name.trim().replace(/\.exe$/i, ""))
    .filter(Boolean);
}

function isProcessRunning(processName: string): boolean {
  const image = `${processName}.exe`;
  const result = spawnSync(
    "tasklist",
    ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"],
    { encoding: "utf8", windowsHide: true, timeout: 5_000 },
  );
  if (result.status !== 0) return false;
  return result.stdout.toLowerCase().includes(image.toLowerCase());
}

async function isIracingSimRunning(): Promise<boolean> {
  try {
    const response = await fetch(IRACING_SIM_STATUS_URL, {
      signal: AbortSignal.timeout(800),
    });
    const body = await response.text();
    return body.includes("running:1");
  } catch {
    return false;
  }
}

export function createWindowsGamingActivity(deps: {
  logger?: Logger;
  processNames?: string[];
}): GamingActivityPort {
  const log = deps.logger?.child({ component: "WindowsGamingActivity" });
  const processNames = deps.processNames ?? parseProcessNamesFromEnv();

  return {
    async isActive(): Promise<boolean> {
      const startedAt = performance.now();
      if (await isIracingSimRunning()) {
        log?.debug("Gaming activity detected via iRacing sim status", {
          durationMs: Math.round(performance.now() - startedAt),
        });
        return true;
      }

      for (const processName of processNames) {
        if (isProcessRunning(processName)) {
          log?.debug("Gaming activity detected via process", {
            processName,
            durationMs: Math.round(performance.now() - startedAt),
          });
          return true;
        }
      }

      log?.debug("No gaming activity detected", {
        durationMs: Math.round(performance.now() - startedAt),
      });
      return false;
    },
  };
}

export function createGamingActivity(deps: {
  logger?: Logger;
  processNames?: string[];
}): GamingActivityPort {
  if (process.platform !== "win32") {
    return {
      async isActive() {
        return false;
      },
    };
  }
  return createWindowsGamingActivity(deps);
}
