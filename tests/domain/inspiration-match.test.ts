import { describe, expect, it } from "vitest";
import { parseInspirationConfig } from "@/src/domain/inspiration-config";
import {
  alignmentScore,
  applyQuotaReorder,
  boostScore,
  DEFAULT_MATCH_PAIR_WEIGHTS,
  matchIdeas,
  rankVideoIdeaPairs,
  scoreVideoIdeaPair,
  selectIdeasForGenerateFill,
  studioSignalScore,
} from "@/src/domain/inspiration";

describe("inspiration match", () => {
  it("scores overlapping tokens", () => {
    const idea = {
      id: "i1",
      title: "Oschersleben battle for P2",
      summary: "Door-to-door last laps",
      suggestedTitles: ["Last lap fight at Oschersleben"],
      outline: "Show the divebomb",
    };
    expect(alignmentScore("Oschersleben last lap battle", idea)).toBeGreaterThan(0.2);
  });

  it("boosts without exceeding 1", () => {
    expect(boostScore(0.95, 1, 0.12)).toBe(1);
  });

  it("reorders so matched fill quota first", () => {
    const items = [
      { id: "a", matched: false },
      { id: "b", matched: true },
      { id: "c", matched: false },
      { id: "d", matched: true },
    ];
    const { ordered, shortfall } = applyQuotaReorder(
      items,
      (c) => c.matched,
      4,
      0.4,
    );
    expect(ordered.slice(0, 2).every((c) => c.matched)).toBe(true);
    expect(shortfall).toBe(0);
  });

  it("reports shortfall when too few matched candidates", () => {
    const items = [
      { id: "a", matched: false },
      { id: "b", matched: false },
      { id: "c", matched: true },
      { id: "d", matched: false },
      { id: "e", matched: false },
    ];
    const { ordered, shortfall } = applyQuotaReorder(
      items,
      (c) => c.matched,
      5,
      0.4,
    );
    expect(shortfall).toBe(1);
    expect(ordered[0]?.matched).toBe(true);
  });

  it("matchIdeas returns ids above min score", () => {
    const ideas = [
      {
        id: "i1",
        title: "Oschersleben battle for P2",
        summary: "Door-to-door last laps",
        suggestedTitles: ["Last lap fight at Oschersleben"],
        outline: "Show the divebomb",
      },
      {
        id: "i2",
        title: "Monza setup tips",
        summary: "Optimize brake bias",
        suggestedTitles: ["Brake bias guide"],
        outline: "Walk through garage menu",
      },
    ];
    const result = matchIdeas("Oschersleben last lap battle", ideas, 0.25);
    expect(result.ideaIds).toEqual(["i1"]);
    expect(result.alignmentScore).toBeGreaterThan(0.25);
  });

  it("scores studio signal higher when idea fields are rich", () => {
    expect(
      studioSignalScore({
        id: "a",
        title: "t",
        summary: "s",
        suggestedTitles: [],
        outline: "",
      }),
    ).toBeLessThan(
      studioSignalScore({
        id: "b",
        title: "t",
        summary: "s",
        suggestedTitles: ["x"],
        outline: "o",
        audienceInterest: "fans",
        channelAlignment: "craft",
        relatedInterest: { items: ["safety car"] },
      }),
    );
  });

  it("ranks pairs and keeps at most one idea per video", () => {
    const videos = [
      { id: "v1", title: "wet race oschersleben", viewCount: 1000, likeCount: 50, commentCount: 10 },
      { id: "v2", title: "dry qualifying monza", viewCount: 100, likeCount: 5, commentCount: 1 },
    ];
    const ideas = [
      {
        id: "i1",
        title: "Wet qualifying drama",
        summary: "Rain at oschersleben",
        suggestedTitles: ["Wet race"],
        outline: "spray",
        audienceInterest: "fans",
        channelAlignment: "craft",
      },
      {
        id: "i2",
        title: "Monza start chaos",
        summary: "First lap monza",
        suggestedTitles: [],
        outline: "",
      },
    ];
    const ranked = rankVideoIdeaPairs(videos, ideas, {
      k: 2,
      now: new Date("2026-08-15T12:00:00.000Z"),
      latestSuccessfulSyncAt: new Date("2026-08-14T12:00:00.000Z"),
      staleDays: 7,
      ideaCapturedAtById: {
        i1: new Date("2026-08-14T12:00:00.000Z"),
        i2: new Date("2026-08-14T12:00:00.000Z"),
      },
      weights: DEFAULT_MATCH_PAIR_WEIGHTS,
    });
    expect(ranked).toHaveLength(2);
    expect(new Set(ranked.map((p) => p.sourceVideoId)).size).toBe(2);
    expect(ranked[0].pairScore).toBeGreaterThanOrEqual(ranked[1].pairScore);
  });

  it("selectIdeasForGenerateFill skips already matched", () => {
    const ideas = [
      {
        id: "i1",
        title: "Already used",
        summary: "Matched earlier",
        suggestedTitles: [],
        outline: "",
      },
      {
        id: "i2",
        title: "Fresh idea",
        summary: "Still available",
        suggestedTitles: [],
        outline: "",
      },
      {
        id: "i3",
        title: "Another fresh",
        summary: "Also available",
        suggestedTitles: [],
        outline: "",
      },
    ];
    const fill = selectIdeasForGenerateFill(ideas, new Set(["i1"]), 2);
    expect(fill.map((i) => i.id)).toEqual(["i2", "i3"]);
  });
});

describe("inspiration config", () => {
  it("uses stale config defaults when env is empty", () => {
    expect(parseInspirationConfig({})).toEqual({
      matchMin: 0.25,
      scoreBoost: 0.12,
      quotaRatio: 0.4,
      staleDays: 7,
      generateFillMax: 3,
    });
  });
});
