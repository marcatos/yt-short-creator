import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/match",
}));

import { MatchBoard } from "@/app/components/MatchBoard";
import { NAV_GROUPS, NavSidebar } from "@/app/components/NavSidebar";

function render(node: React.ReactElement): string {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  return renderToStaticMarkup(node);
}

describe("match UI", () => {
  it("places Match after Library in Pipeline nav", () => {
    const pipeline = NAV_GROUPS.find((group) => group.label === "Pipeline");
    expect(pipeline?.items.map((item) => item.href)).toEqual([
      "/",
      "/library",
      "/match",
      "/candidates",
      "/jobs",
    ]);
  });

  it("renders Match in the sidebar", () => {
    const markup = render(
      createElement(NavSidebar, { collapsed: false, mobileOpen: false }),
    );
    expect(markup).toContain("Match");
    expect(markup).toContain('href="/match"');
  });

  it("disables Run match until videos, ideas, and pairs are ready", () => {
    const markup = render(
      createElement(MatchBoard, {
        channelId: "ch-1",
        inspirationStale: false,
        videos: [
          {
            id: "vid-1",
            title: "Monza safety car",
            durationSec: 600,
            viewCount: 1000,
            likeCount: 40,
            commentCount: 8,
          },
        ],
        ideas: [
          {
            id: "idea-1",
            title: "Yellow flag drama",
            summary: "Restart chaos",
            audienceInterest: "fans",
            channelAlignment: "craft",
          },
        ],
      }),
    );
    expect(markup).toContain("Monza safety car");
    expect(markup).toContain("Yellow flag drama");
    expect(markup).toContain("Run match");
    expect(markup).toContain("disabled");
    expect(markup).toContain("Select at least one video and one idea");
  });
});
