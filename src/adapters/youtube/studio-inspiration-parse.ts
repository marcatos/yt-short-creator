import { createHash } from "node:crypto";

import type { CapturedInspirationIdea } from "@/src/ports/youtube-studio-inspiration";

const RAW_SNIPPET_MAX = 1500;

const CHROME_LINE =
  /^(more like this|altri come questo|show more|mostra altro|bookmark|salva|create ideas|crea idee|update idea|aggiorna idea)$/i;

type SectionKey =
  | "audienceInterest"
  | "channelAlignment"
  | "relatedInterest"
  | "outline"
  | "suggestedTitles"
  | "thumbnailNotes";

const SECTION_LABELS: Array<{ key: SectionKey; test: RegExp }> = [
  {
    key: "audienceInterest",
    test: /^(?:audience interest|interesse (?:del )?pubblico)(?:\s*[:·-]\s*(.*))?$/i,
  },
  {
    key: "channelAlignment",
    test: /^(?:channel alignment|allineamento(?: del)? canale)(?:\s*[:·-]\s*(.*))?$/i,
  },
  {
    key: "relatedInterest",
    test: /^(?:related (?:interest|videos)|interesse correlat\w*|video correlat\w*)(?:\s*[:·-]\s*(.*))?$/i,
  },
  {
    key: "outline",
    test: /^(?:outline|scaletta|struttura)(?:\s*[:·-]\s*(.*))?$/i,
  },
  {
    key: "suggestedTitles",
    test: /^(?:suggested titles|titles|titoli suggerit\w*|titoli)(?:\s*[:·-]\s*(.*))?$/i,
  },
  {
    key: "thumbnailNotes",
    test: /^(?:thumbnail notes|thumbnails?|miniatur\w*)(?:\s*[:·-]\s*(.*))?$/i,
  },
];

export function normalizeInspirationText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function buildInspirationExternalKey(input: {
  studioId?: string | null;
  title: string;
  summary: string;
}): string {
  const studioId = input.studioId?.trim();
  if (studioId) return `studio:${studioId}`;
  const payload = `${normalizeInspirationText(input.title)}\n${normalizeInspirationText(input.summary)}`;
  const digest = createHash("sha256").update(payload).digest("hex").slice(0, 16);
  return `hash:${digest}`;
}

export function parseSuggestedTitles(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

export function parseRelatedInterest(text: string | null | undefined): unknown | null {
  if (!text?.trim()) return null;
  const items = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { items, raw: text.trim() };
}

export function truncateInspirationSnippet(text: string, max = RAW_SNIPPET_MAX): string | null {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function matchSection(line: string): { key: SectionKey; rest: string } | null {
  for (const { key, test } of SECTION_LABELS) {
    const match = line.match(test);
    if (!match) continue;
    const rest = (match[1] ?? "").trim();
    return { key, rest };
  }
  return null;
}

function emptySections(): Record<SectionKey, string[]> {
  return {
    audienceInterest: [],
    channelAlignment: [],
    relatedInterest: [],
    outline: [],
    suggestedTitles: [],
    thumbnailNotes: [],
  };
}

function parseLabeledDocument(text: string): {
  preamble: string[];
  sections: Record<SectionKey, string[]>;
} {
  const sections = emptySections();
  const preamble: string[] = [];
  let current: SectionKey | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || CHROME_LINE.test(line)) continue;
    const section = matchSection(line);
    if (section) {
      current = section.key;
      if (section.rest) sections[current].push(section.rest);
      continue;
    }
    if (current) {
      sections[current].push(line);
    } else {
      preamble.push(line);
    }
  }

  return { preamble, sections };
}

function joinSection(lines: string[]): string | null {
  const value = lines.join("\n").trim();
  return value ? value : null;
}

export function parseIdeaFromTexts(input: {
  studioId?: string | null;
  cardText: string;
  detailText?: string;
}): CapturedInspirationIdea {
  const card = parseLabeledDocument(input.cardText);
  const detail = parseLabeledDocument(input.detailText ?? "");
  const title = (card.preamble[0] ?? detail.preamble[0] ?? "").trim();
  const summary =
    card.preamble.slice(1).join(" ").trim() ||
    detail.preamble.slice(1).join(" ").trim();
  if (!title || !summary) {
    throw new Error("Inspiration card missing title or summary");
  }

  const join = (key: SectionKey): string | null =>
    joinSection(detail.sections[key]) ?? joinSection(card.sections[key]);

  const combined = [input.cardText, input.detailText]
    .filter((part) => part && part.trim())
    .join("\n");

  return {
    externalKey: buildInspirationExternalKey({
      studioId: input.studioId,
      title,
      summary,
    }),
    title,
    summary,
    audienceInterest: join("audienceInterest"),
    channelAlignment: join("channelAlignment"),
    relatedInterest: parseRelatedInterest(join("relatedInterest")),
    outline: join("outline"),
    suggestedTitles: parseSuggestedTitles(join("suggestedTitles")),
    thumbnailNotes: join("thumbnailNotes"),
    rawSnippet: truncateInspirationSnippet(combined),
  };
}
