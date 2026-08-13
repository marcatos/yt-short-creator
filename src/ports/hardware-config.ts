import type { HardwareConfig } from "@/src/domain/hardware";

export interface HardwareConfigPort {
  get(): Promise<HardwareConfig>;
}
