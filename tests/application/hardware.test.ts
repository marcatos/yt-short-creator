import { describe, expect, it } from "vitest";

import {
  createGetHardware,
  createUpdateHardware,
} from "@/src/application/hardware";
import { DEFAULT_HARDWARE, type HardwareConfig } from "@/src/domain/hardware";
import type { HardwareConfigPort } from "@/src/ports/hardware-config";
import type { Logger } from "@/src/ports/logger";

const noop = () => {};
const logger: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  child: () => logger,
};

function memoryHardware(initial: HardwareConfig = DEFAULT_HARDWARE): HardwareConfigPort {
  let stored = initial;
  return {
    get: async () => stored,
    save: async (next) => {
      stored = next;
    },
  };
}

describe("hardware use cases", () => {
  it("returns the stored postazione", async () => {
    const hardware = memoryHardware();
    const getHardware = createGetHardware({ hardware, logger });
    await expect(getHardware()).resolves.toEqual(DEFAULT_HARDWARE);
  });

  it("saves trimmed postazione fields", async () => {
    const hardware = memoryHardware();
    const updateHardware = createUpdateHardware({ hardware, logger });
    const updated = await updateHardware({
      ...DEFAULT_HARDWARE,
      gpu: "  RTX 4070  ",
      buttonBox: "  ",
    });

    expect(updated.gpu).toBe("RTX 4070");
    expect(updated.buttonBox).toBe("");
    await expect(hardware.get()).resolves.toEqual(updated);
  });
});
