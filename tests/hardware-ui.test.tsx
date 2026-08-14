import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HardwareForm } from "@/app/components/HardwareForm";
import { DEFAULT_HARDWARE } from "@/src/domain/hardware";

describe("hardware setup UI", () => {
  it("pre-fills the postazione form and shows the YouTube description preview", () => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    const markup = renderToStaticMarkup(
      createElement(HardwareForm, { initial: DEFAULT_HARDWARE }),
    );

    expect(markup).toContain("AMD Ryzen 7 9800X3D");
    expect(markup).toContain("MSI B850M GAMING PLUS WIFI");
    expect(markup).toContain("ARCTIC Liquid Freezer III Pro 240");
    expect(markup).toContain("5x Thermalright TL-C12C + 2x Thermalright TL-C14C");
    expect(markup).toContain("Mars Gaming MC-VIEW2");
    expect(markup).toContain("TREQ One");
    expect(markup).toContain("VRS DirectForce Pro 20Nm");
    expect(markup).toContain("Formula VRS DirectForce Pro");
    expect(markup).toContain("Sector 17 LED iFlag");
    expect(markup).toContain("Focusrite Scarlett 2i2 4th Gen");
    expect(markup).toContain("M-Audio BX4");
    expect(markup).toContain("Sennheiser HD518");
    expect(markup).toContain("Audio-Technica AT2020");
    expect(markup).toContain("RØDE PSA1+");
    expect(markup).toContain("Triple Samsung Odyssey G5 32");
    expect(markup).toContain("LA MIA POSTAZIONE SIM RACING");
    expect(markup).toContain("MY SIM RACING SETUP");
    expect(markup).toContain("Save setup");
  });
});
