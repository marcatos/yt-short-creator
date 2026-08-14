import { describe, expect, it } from "vitest";

import {
  DEFAULT_HARDWARE,
  HARDWARE_GROUPS,
  mergeHardware,
  renderHardwareBlock,
} from "@/src/domain/hardware";

describe("hardware block", () => {
  it("renders Italian labels without LLM", () => {
    const block = renderHardwareBlock(DEFAULT_HARDWARE, "it");
    expect(block).toContain("LA MIA POSTAZIONE SIM RACING");
    expect(block).toContain("Base volante:");
    expect(block).toContain(DEFAULT_HARDWARE.wheelbase);
  });

  it("renders English labels", () => {
    const block = renderHardwareBlock(
      mergeHardware({ gpu: "RTX 4080" }),
      "en",
    );
    expect(block).toContain("MY SIM RACING SETUP");
    expect(block).toContain("Wheelbase:");
    expect(block).toContain("GPU: RTX 4080");
  });

  it("groups PC, sim rig, and monitors like the YouTube description", () => {
    const block = renderHardwareBlock(DEFAULT_HARDWARE, "it");
    expect(block).toMatch(/PC\n• CPU:/);
    expect(block).toMatch(/SIM RIG\n• Cockpit:/);
    expect(block).toMatch(/MONITOR\n• Monitor:/);
    expect(HARDWARE_GROUPS.map((group) => group.id)).toEqual([
      "pc",
      "simRig",
      "monitors",
    ]);
  });

  it("keeps explicit blank fields blank so they can be omitted", () => {
    const merged = mergeHardware({ ram: "  ", buttonBox: "" });
    expect(merged.ram).toBe("");
    expect(merged.buttonBox).toBe("");
    expect(merged.cpu).toBe(DEFAULT_HARDWARE.cpu);
  });

  it("returns empty string when all fields blank", () => {
    const blank = mergeHardware({
      cpu: " ",
      gpu: "",
      ram: "",
      rig: "",
      wheelbase: "",
      pedals: "",
      seat: "",
      buttonBox: "",
      monitors: "",
      resolution: "",
    }, {
      cpu: "",
      gpu: "",
      ram: "",
      rig: "",
      wheelbase: "",
      pedals: "",
      seat: "",
      buttonBox: "",
      monitors: "",
      resolution: "",
    });
    expect(renderHardwareBlock(blank, "en")).toBe("");
  });
});
