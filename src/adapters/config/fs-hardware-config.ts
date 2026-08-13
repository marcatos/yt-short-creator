import fs from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_HARDWARE,
  mergeHardware,
  type HardwareConfig,
} from "@/src/domain/hardware";
import type { HardwareConfigPort } from "@/src/ports/hardware-config";
import type { Logger } from "@/src/ports/logger";

export function createFsHardwareConfig(deps: {
  configPath?: string;
  logger?: Logger;
}): HardwareConfigPort {
  const configPath =
    deps.configPath ?? path.join(process.cwd(), "config", "hardware.json");

  return {
    async get(): Promise<HardwareConfig> {
      try {
        const raw = await fs.readFile(configPath, "utf8");
        const parsed = JSON.parse(raw) as Partial<HardwareConfig>;
        return mergeHardware(parsed);
      } catch (error) {
        deps.logger?.warn("Hardware config missing or invalid; using defaults", {
          configPath,
          error: error instanceof Error ? error.message : String(error),
        });
        return DEFAULT_HARDWARE;
      }
    },
  };
}
