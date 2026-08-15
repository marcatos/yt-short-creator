import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/candidates",
}));

import {
  isNavItemActive,
  NAV_GROUPS,
  NavSidebar,
} from "@/app/components/NavSidebar";
import { PageHeader } from "@/app/components/PageHeader";
import { LayoutDensityToggle } from "@/app/components/LayoutDensityToggle";
import {
  parseLayoutDensity,
  LAYOUT_DENSITY_BOOTSTRAP,
  LAYOUT_DENSITY_KEY,
} from "@/app/lib/layout-density";

function render(node: React.ReactElement): string {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  return renderToStaticMarkup(node);
}

describe("layout density", () => {
  it("treats missing or unknown values as normal", () => {
    expect(parseLayoutDensity(null)).toBe("normal");
    expect(parseLayoutDensity("wide")).toBe("normal");
    expect(parseLayoutDensity("compact")).toBe("compact");
  });

  it("bootstraps compact from localStorage before paint", () => {
    expect(LAYOUT_DENSITY_BOOTSTRAP).toContain(LAYOUT_DENSITY_KEY);
    expect(LAYOUT_DENSITY_BOOTSTRAP).toContain("data-layout");
    expect(LAYOUT_DENSITY_BOOTSTRAP).toContain("compact");
  });

  it("renders normale and compact choices", () => {
    const markup = render(createElement(LayoutDensityToggle));
    expect(markup).toContain("Normale");
    expect(markup).toContain("Compatto");
    expect(markup).toContain("Densità layout");
  });
});

describe("app shell navigation", () => {
  it("marks nested candidate routes active", () => {
    expect(isNavItemActive("/candidates", "/candidates")).toBe(true);
    expect(isNavItemActive("/candidates/abc", "/candidates")).toBe(true);
    expect(isNavItemActive("/library", "/candidates")).toBe(false);
    expect(isNavItemActive("/", "/")).toBe(true);
    expect(isNavItemActive("/library", "/")).toBe(false);
  });

  it("exposes pipeline capture and desk groups", () => {
    expect(NAV_GROUPS.map((group) => group.label)).toEqual([
      "Pipeline",
      "Capture",
      "Desk",
    ]);
    expect(NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href))).toContain(
      "/connect",
    );
  });

  it("highlights the active sidebar link", () => {
    const markup = render(
      createElement(NavSidebar, { collapsed: false, mobileOpen: false }),
    );
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("Candidates");
    expect(markup).toContain("SHORT CONTROL");
  });

  it("renders page header actions", () => {
    const markup = render(
      createElement(PageHeader, {
        eyebrow: "Approval queue",
        title: "Candidate triage",
        actions: createElement("strong", null, "3 loaded"),
      }),
    );
    expect(markup).toContain("Approval queue");
    expect(markup).toContain("Candidate triage");
    expect(markup).toContain("3 loaded");
  });
});
