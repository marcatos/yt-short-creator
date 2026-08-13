import { describe, expect, it } from "vitest";

import {
  DEFAULT_HARDWARE,
  mergeHardware,
  renderHardwareBlock,
} from "@/src/domain/hardware";

describe("hardware block", () => {
  it("renders Italian labels without LLM", () => {
    const block = renderHardwareBlock(DEFAULT_HARDWARE, "it");
    expect(block).toContain("Setup / Hardware");
    expect(block).toContain("Base volante:");
    expect(block).toContain(DEFAULT_HARDWARE.wheelbase);
  });

  it("renders English labels", () => {
    const block = renderHardwareBlock(
      mergeHardware({ gpu: "RTX 4080" }),
      "en",
    );
    expect(block).toContain("Wheelbase:");
    expect(block).toContain("GPU: RTX 4080");
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
