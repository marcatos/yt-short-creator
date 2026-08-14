import { describe, expect, it } from "vitest";

import {
  buildInspirationExternalKey,
  parseIdeaFromTexts,
} from "@/src/adapters/youtube/studio-inspiration-parse";
import {
  createYouTubeStudioInspirationAdapter,
  type StudioPersistentContext,
} from "@/src/adapters/youtube/studio-inspiration";
import {
  INSPIRATION_SELECTORS,
  createPlaywrightInspirationHelpers,
  scrapeInspirationIdeas,
  type InspirationPageHelpers,
  type LocatorLike,
  type PageLike,
} from "@/src/adapters/youtube/studio-inspiration-scrape";
import type { CapturedInspirationIdea } from "@/src/ports/youtube-studio-inspiration";
import {
  StudioInspirationUiError,
  StudioSessionUnavailableError,
} from "@/src/ports/youtube-studio-inspiration";
import type { Logger } from "@/src/ports/logger";

const EN_CARD = `Wet race guide for Oschersleben
A practical look at rain lines, braking, and tire temps.
More like this
Audience interest
High · 12K weekly views in topic`;

const EN_DETAIL = `Wet race guide for Oschersleben
A practical look at rain lines, braking, and tire temps.
Channel alignment
Fits your sim racing tutorials and onboard analysis.
Related interest
iRacing Oschersleben wet — 240K views
Assetto Corsa rain setup — 88K views
Outline
1. Warm-up lap
2. Braking zones
Suggested titles
Oschersleben Wet Race Guide
Rain Driving Tips for Sim Racers
Thumbnails
Driver spray onboard with large RAIN text`;

const IT_CARD = `Guida al bagnato a Oschersleben
Uno sguardo pratico a traiettorie e frenata.
Interesse del pubblico: Alto
Allineamento del canale: Tutorial sim racing
Titoli
Guida Oschersleben sotto la pioggia
Miniatura
Spray e mappa del circuito`;

function idea(overrides: Partial<CapturedInspirationIdea> = {}): CapturedInspirationIdea {
  return {
    externalKey: "studio:idea-1",
    title: "Idea one",
    summary: "Summary one",
    audienceInterest: "High",
    channelAlignment: "On brand",
    relatedInterest: { items: ["Related A"] },
    outline: "1. Hook",
    suggestedTitles: ["Title A"],
    thumbnailNotes: "Bold text",
    rawSnippet: "Idea one Summary one",
    ...overrides,
  };
}

function createLogger(warns: Array<{ msg: string; ctx?: Record<string, unknown> }> = []): Logger {
  const logger: Logger = {
    debug() {},
    info() {},
    warn(msg, ctx) {
      warns.push({ msg, ctx });
    },
    error() {},
    child: () => logger,
  };
  return logger;
}

function helpersFromCards(
  cards: Array<{
    idea?: CapturedInspirationIdea;
    expanded?: boolean;
    fail?: boolean;
  }>,
  extras?: Partial<InspirationPageHelpers>,
): InspirationPageHelpers {
  return {
    async gotoAndEnsureSignedIn() {},
    async openInspirationFeed() {},
    async countCards() {
      return cards.length;
    },
    async captureCard(index: number) {
      const card = cards[index];
      if (!card || card.fail) throw new Error(`card ${index + 1} failed`);
      return {
        idea: card.idea ?? idea({ externalKey: `studio:idea-${index + 1}` }),
        expanded: card.expanded ?? true,
      };
    },
    ...extras,
  };
}

function emptyLocator(): LocatorLike {
  const self: LocatorLike = {
    first: () => self,
    nth: () => self,
    count: async () => 0,
    click: async () => {
      throw new Error("empty locator click");
    },
    innerText: async () => "",
    getAttribute: async () => null,
    isVisible: async () => false,
    waitFor: async () => {
      throw new Error("waitFor timeout");
    },
  };
  return self;
}

function locatorFrom(script: {
  count?: number;
  visible?: boolean;
  text?: string;
  attrs?: Record<string, string>;
  click?: () => void;
  nth?: (index: number) => LocatorLike;
}): LocatorLike {
  const self: LocatorLike = {
    first: () => self,
    nth: (index) => script.nth?.(index) ?? (index === 0 ? self : emptyLocator()),
    count: async () => script.count ?? (script.visible === false ? 0 : 1),
    click: async () => {
      script.click?.();
    },
    innerText: async () => script.text ?? "",
    getAttribute: async (name) => script.attrs?.[name] ?? null,
    isVisible: async () => script.visible ?? (script.count ?? 1) > 0,
    waitFor: async () => {
      if (script.visible === false || script.count === 0) {
        throw new Error("waitFor timeout");
      }
    },
  };
  return self;
}

describe("parseIdeaFromTexts", () => {
  it("extracts EN idea fields and hashes when Studio id is missing", () => {
    const parsed = parseIdeaFromTexts({ cardText: EN_CARD, detailText: EN_DETAIL });
    expect(parsed.title).toBe("Wet race guide for Oschersleben");
    expect(parsed.summary).toBe(
      "A practical look at rain lines, braking, and tire temps.",
    );
    expect(parsed.audienceInterest).toBe("High · 12K weekly views in topic");
    expect(parsed.channelAlignment).toBe(
      "Fits your sim racing tutorials and onboard analysis.",
    );
    expect(parsed.relatedInterest).toEqual({
      items: [
        "iRacing Oschersleben wet — 240K views",
        "Assetto Corsa rain setup — 88K views",
      ],
      raw: "iRacing Oschersleben wet — 240K views\nAssetto Corsa rain setup — 88K views",
    });
    expect(parsed.outline).toContain("Warm-up lap");
    expect(parsed.suggestedTitles).toEqual([
      "Oschersleben Wet Race Guide",
      "Rain Driving Tips for Sim Racers",
    ]);
    expect(parsed.thumbnailNotes).toContain("RAIN");
    expect(parsed.externalKey).toMatch(/^hash:[a-f0-9]{16}$/);
    expect(parsed.rawSnippet).toContain("Wet race guide");
  });

  it("extracts IT labels and prefers a Studio id", () => {
    const parsed = parseIdeaFromTexts({
      studioId: "idea-it-9",
      cardText: IT_CARD,
    });
    expect(parsed.externalKey).toBe("studio:idea-it-9");
    expect(parsed.audienceInterest).toBe("Alto");
    expect(parsed.channelAlignment).toContain("Tutorial");
    expect(parsed.suggestedTitles).toEqual(["Guida Oschersleben sotto la pioggia"]);
    expect(parsed.thumbnailNotes).toContain("Spray");
  });

  it("throws when title or summary is missing", () => {
    expect(() => parseIdeaFromTexts({ cardText: "Only a title" })).toThrow(
      /missing title or summary/i,
    );
  });

  it("uses a stable hash for the same title and summary", () => {
    const a = buildInspirationExternalKey({
      title: "  Foo BAR ",
      summary: "Same\nsummary",
    });
    const b = buildInspirationExternalKey({
      title: "foo bar",
      summary: "same summary",
    });
    expect(a).toBe(b);
  });
});

describe("scrapeInspirationIdeas", () => {
  it("returns ok when every card expands", async () => {
    const result = await scrapeInspirationIdeas(
      helpersFromCards([
        { idea: idea({ externalKey: "studio:a", title: "A", summary: "SA" }) },
        { idea: idea({ externalKey: "studio:b", title: "B", summary: "SB" }) },
      ]),
    );
    expect(result.status).toBe("ok");
    expect(result.ideas.map((item) => item.externalKey)).toEqual([
      "studio:a",
      "studio:b",
    ]);
  });

  it("returns partial and warns when a card fails", async () => {
    const warns: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
    const result = await scrapeInspirationIdeas(
      helpersFromCards([
        { idea: idea({ externalKey: "studio:ok" }) },
        { fail: true },
        { idea: idea({ externalKey: "studio:ok-2" }) },
      ]),
      createLogger(warns),
    );
    expect(result.status).toBe("partial");
    expect(result.ideas.map((item) => item.externalKey)).toEqual([
      "studio:ok",
      "studio:ok-2",
    ]);
    expect(warns.some((entry) => /card capture failed/i.test(entry.msg))).toBe(
      true,
    );
  });

  it("returns partial when a card does not expand", async () => {
    const result = await scrapeInspirationIdeas(
      helpersFromCards([
        { idea: idea({ externalKey: "studio:list-only" }), expanded: false },
      ]),
    );
    expect(result.status).toBe("partial");
    expect(result.ideas).toHaveLength(1);
  });

  it("throws StudioInspirationUiError when there are zero cards", async () => {
    await expect(scrapeInspirationIdeas(helpersFromCards([]))).rejects.toBeInstanceOf(
      StudioInspirationUiError,
    );
    await expect(scrapeInspirationIdeas(helpersFromCards([]))).rejects.toThrow(
      /no inspiration idea cards found/i,
    );
  });

  it("throws when every card capture fails", async () => {
    await expect(
      scrapeInspirationIdeas(helpersFromCards([{ fail: true }, { fail: true }])),
    ).rejects.toThrow(/all inspiration idea cards failed/i);
  });
});

describe("createPlaywrightInspirationHelpers", () => {
  it("treats Google login redirect as a missing session", async () => {
    const page: PageLike = {
      url: () => "https://accounts.google.com/signin",
      async goto() {},
      locator: () => emptyLocator(),
      getByRole: () => emptyLocator(),
      keyboard: { press: async () => {} },
    };
    const helpers = createPlaywrightInspirationHelpers(page);
    await expect(helpers.gotoAndEnsureSignedIn()).rejects.toBeInstanceOf(
      StudioSessionUnavailableError,
    );
  });

  it("opens the Inspiration URL from the channel id and clicks the tab", async () => {
    const gotos: string[] = [];
    const clicks: string[] = [];
    const locators = new Map<string, LocatorLike>([
      [
        INSPIRATION_SELECTORS.studioApp,
        locatorFrom({ visible: true, count: 1 }),
      ],
      [
        INSPIRATION_SELECTORS.ideaCardCandidates.join(", "),
        locatorFrom({ visible: true, count: 1, text: EN_CARD }),
      ],
      [
        INSPIRATION_SELECTORS.ideaCardCandidates[0],
        locatorFrom({
          count: 1,
          text: EN_CARD,
          attrs: { "data-idea-id": "card-1" },
        }),
      ],
      [
        INSPIRATION_SELECTORS.detailPanel,
        locatorFrom({ visible: true, text: EN_DETAIL }),
      ],
      [
        INSPIRATION_SELECTORS.closeDetail,
        locatorFrom({ visible: true, click: () => clicks.push("close") }),
      ],
    ]);
    const tab = locatorFrom({
      count: 1,
      click: () => clicks.push("tab"),
    });
    const page: PageLike = {
      url: () => "https://studio.youtube.com/channel/UC123abc/videos/upload",
      async goto(url) {
        gotos.push(url);
      },
      locator: (selector) => locators.get(selector) ?? emptyLocator(),
      getByRole: (role) => (role === "tab" ? tab : emptyLocator()),
      keyboard: { press: async () => clicks.push("escape") },
    };

    const helpers = createPlaywrightInspirationHelpers(page);
    await helpers.gotoAndEnsureSignedIn();
    await helpers.openInspirationFeed();
    expect(gotos).toContain(INSPIRATION_SELECTORS.studioHome);
    expect(gotos).toContain(INSPIRATION_SELECTORS.inspirationPath("UC123abc"));
    expect(clicks).toContain("tab");
    expect(await helpers.countCards()).toBe(1);

    const captured = await helpers.captureCard(0);
    expect(captured.expanded).toBe(true);
    expect(captured.idea.externalKey).toBe("studio:card-1");
    expect(captured.idea.suggestedTitles).toHaveLength(2);
    expect(clicks).toContain("close");
  });

  it("clicks Content then the Inspiration tab when the URL has no channel id", async () => {
    const gotos: string[] = [];
    const clicks: string[] = [];
    const contentLink = locatorFrom({
      count: 1,
      click: () => clicks.push("content"),
    });
    const inspirationTab = locatorFrom({
      count: 1,
      click: () => clicks.push("inspiration-tab"),
    });
    const page: PageLike = {
      url: () => "https://studio.youtube.com/",
      async goto(url) {
        gotos.push(url);
      },
      locator: (selector) =>
        selector === INSPIRATION_SELECTORS.ideaCardCandidates.join(", ")
          ? locatorFrom({ visible: true, count: 1 })
          : emptyLocator(),
      getByRole: (role) => {
        if (role === "link" || role === "menuitem") return contentLink;
        if (role === "tab") return inspirationTab;
        return emptyLocator();
      },
      keyboard: { press: async () => {} },
    };

    await createPlaywrightInspirationHelpers(page).openInspirationFeed();
    expect(gotos).toEqual([]);
    expect(clicks).toEqual(["content", "inspiration-tab"]);
  });

  it("does not click a Videos tab when falling back to paper-tab locators", async () => {
    const clicks: string[] = [];
    const videosTab = locatorFrom({
      text: "Videos",
      click: () => clicks.push("videos"),
    });
    const inspirationTab = locatorFrom({
      text: "Ispirazione",
      click: () => clicks.push("ispirazione"),
    });
    const paperTabs = locatorFrom({
      count: 2,
      nth: (index) => (index === 0 ? videosTab : inspirationTab),
    });
    const page: PageLike = {
      url: () => "https://studio.youtube.com/channel/UCabc/videos/upload",
      async goto() {},
      locator: (selector) => {
        if (selector === INSPIRATION_SELECTORS.inspirationTabCandidates[0]) {
          return paperTabs;
        }
        if (selector === INSPIRATION_SELECTORS.ideaCardCandidates.join(", ")) {
          return locatorFrom({ visible: true, count: 1 });
        }
        return emptyLocator();
      },
      getByRole: () => emptyLocator(),
      keyboard: { press: async () => {} },
    };

    await createPlaywrightInspirationHelpers(page).openInspirationFeed();
    expect(clicks).toEqual(["ispirazione"]);
  });

  it("throws when the Inspiration tab cannot be found", async () => {
    const page: PageLike = {
      url: () => "https://studio.youtube.com/",
      async goto() {},
      locator: () => emptyLocator(),
      getByRole: (role) =>
        role === "link"
          ? locatorFrom({ count: 1, click: () => undefined })
          : emptyLocator(),
      keyboard: { press: async () => {} },
    };
    await expect(
      createPlaywrightInspirationHelpers(page).openInspirationFeed(),
    ).rejects.toThrow(/inspiration tab was not found/i);
  });

  it("marks a card partial when the detail panel never appears", async () => {
    const card = locatorFrom({
      count: 1,
      text: EN_CARD,
      attrs: { "data-idea-id": "list-only" },
    });
    const page: PageLike = {
      url: () => "https://studio.youtube.com/channel/UCabc/videos/inspiration",
      async goto() {},
      locator: (selector) => {
        if (selector === INSPIRATION_SELECTORS.ideaCardCandidates[0]) return card;
        if (selector === INSPIRATION_SELECTORS.detailPanel) {
          return locatorFrom({ visible: false, count: 0 });
        }
        if (selector === INSPIRATION_SELECTORS.closeDetail) {
          return locatorFrom({ visible: false });
        }
        return emptyLocator();
      },
      getByRole: () => emptyLocator(),
      keyboard: { press: async () => {} },
    };

    const captured = await createPlaywrightInspirationHelpers(page).captureCard(0);
    expect(captured.expanded).toBe(false);
    expect(captured.idea.externalKey).toBe("studio:list-only");
    expect(captured.idea.title).toBe("Wet race guide for Oschersleben");
  });
});

describe("createYouTubeStudioInspirationAdapter", () => {
  function contextFromPage(page: unknown): StudioPersistentContext {
    return {
      pages: () => [page],
      newPage: async () => page,
      close: async () => {},
    };
  }

  it("throws StudioSessionUnavailableError when the profile is missing", async () => {
    const adapter = createYouTubeStudioInspirationAdapter({
      env: {},
      profileExists: () => false,
      browserFactory: async () => {
        throw new Error("browser should not launch");
      },
    });
    await expect(adapter.sync()).rejects.toBeInstanceOf(
      StudioSessionUnavailableError,
    );
  });

  it("runs inside the Studio lock and closes the browser after a scrape error", async () => {
    const order: string[] = [];
    const adapter = createYouTubeStudioInspirationAdapter({
      env: { YOUTUBE_STUDIO_HEADED: "1" },
      profileExists: () => true,
      withLock: async (fn) => {
        order.push("lock");
        return fn();
      },
      browserFactory: async ({ headed }) => {
        order.push(headed ? "headed" : "headless");
        return {
          pages: () => [{}],
          newPage: async () => ({}),
          close: async () => {
            order.push("close");
          },
        };
      },
      pageHelpersFactory: () =>
        helpersFromCards([], {
          async gotoAndEnsureSignedIn() {
            throw new StudioInspirationUiError("boom");
          },
        }),
    });

    await expect(adapter.sync()).rejects.toBeInstanceOf(StudioInspirationUiError);
    expect(order).toEqual(["lock", "headed", "close"]);
  });

  it("returns captured ideas from injectable page helpers", async () => {
    const adapter = createYouTubeStudioInspirationAdapter({
      env: {},
      logger: createLogger(),
      profileExists: () => true,
      withLock: async (fn) => fn(),
      browserFactory: async () => contextFromPage({}),
      pageHelpersFactory: () =>
        helpersFromCards([
          { idea: idea({ externalKey: "studio:live-1" }) },
        ]),
    });
    await expect(adapter.sync()).resolves.toEqual({
      status: "ok",
      ideas: [expect.objectContaining({ externalKey: "studio:live-1" })],
    });
  });

  it("wraps unexpected browser errors as StudioInspirationUiError", async () => {
    const adapter = createYouTubeStudioInspirationAdapter({
      env: {},
      profileExists: () => true,
      withLock: async (fn) => fn(),
      browserFactory: async () => {
        throw new Error("chromium exploded");
      },
    });
    await expect(adapter.sync()).rejects.toBeInstanceOf(StudioInspirationUiError);
    await expect(adapter.sync()).rejects.toThrow(/chromium exploded/);
  });
});
