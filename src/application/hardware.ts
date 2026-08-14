import { mergeHardware, type HardwareConfig } from "@/src/domain/hardware";
import type { HardwareConfigPort } from "@/src/ports/hardware-config";
import type { Logger } from "@/src/ports/logger";

export function createGetHardware(deps: {
  hardware: HardwareConfigPort;
  logger: Logger;
}): () => Promise<HardwareConfig> {
  const log = deps.logger.child({ operation: "getHardware" });
  return async () => {
    const startedAt = performance.now();
    log.info("Hardware read started");
    try {
      const hardware = await deps.hardware.get();
      log.info("Hardware read completed", {
        durationMs: Math.round(performance.now() - startedAt),
      });
      return hardware;
    } catch (error) {
      log.error("Hardware read failed", {
        durationMs: Math.round(performance.now() - startedAt),
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  };
}

export function createUpdateHardware(deps: {
  hardware: HardwareConfigPort;
  logger: Logger;
}): (input: HardwareConfig) => Promise<HardwareConfig> {
  const log = deps.logger.child({ operation: "updateHardware" });
  return async (input) => {
    const startedAt = performance.now();
    log.info("Hardware update started");
    try {
      const updated = mergeHardware(input);
      await deps.hardware.save(updated);
      log.info("Hardware update completed", {
        durationMs: Math.round(performance.now() - startedAt),
      });
      return updated;
    } catch (error) {
      log.error("Hardware update failed", {
        durationMs: Math.round(performance.now() - startedAt),
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  };
}
