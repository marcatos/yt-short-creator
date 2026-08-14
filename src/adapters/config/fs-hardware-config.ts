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
  const log = deps.logger?.child({ operation: "hardwareConfig" });

  return {
    async get(): Promise<HardwareConfig> {
      const startedAt = performance.now();
      try {
        const raw = await fs.readFile(configPath, "utf8");
        const parsed = JSON.parse(raw) as Partial<HardwareConfig>;
        const hardware = mergeHardware(parsed);
        log?.debug("Hardware config loaded", {
          configPath,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return hardware;
      } catch (error) {
        log?.warn("Hardware config missing or invalid; using defaults", {
          configPath,
          durationMs: Math.round(performance.now() - startedAt),
          error: error instanceof Error ? error.message : String(error),
        });
        return DEFAULT_HARDWARE;
      }
    },

    async save(hardware: HardwareConfig): Promise<void> {
      const startedAt = performance.now();
      const normalized = mergeHardware(hardware);
      try {
        await fs.mkdir(path.dirname(configPath), { recursive: true });
        const temporaryPath = `${configPath}.tmp`;
        await fs.writeFile(
          temporaryPath,
          `${JSON.stringify(normalized, null, 2)}\n`,
          "utf8",
        );
        await fs.rename(temporaryPath, configPath);
        log?.info("Hardware config saved", {
          configPath,
          durationMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        log?.error("Hardware config save failed", {
          configPath,
          durationMs: Math.round(performance.now() - startedAt),
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : String(error),
        });
        throw error;
      }
    },
  };
}
