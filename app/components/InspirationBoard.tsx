"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { formatListDateTime } from "@/app/lib/format";

export type InspirationBoardIdea = {
  id: string;
  title: string;
  summary: string;
  audienceInterest: string | null;
  channelAlignment: string | null;
  relatedInterest: string | null;
  outline: string | null;
  suggestedTitles: string[];
  thumbnailNotes: string | null;
  capturedAt: string;
};

const CHIP_MAX = 48;

function chipText(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > CHIP_MAX) return null;
  return trimmed;
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function InspirationBoard({ ideas }: { ideas: InspirationBoardIdea[] }) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const tags = useMemo(() => {
    const values = new Set<string>();
    for (const idea of ideas) {
      const audience = chipText(idea.audienceInterest);
      const alignment = chipText(idea.channelAlignment);
      if (audience) values.add(audience);
      if (alignment) values.add(alignment);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [ideas]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return ideas.filter((idea) => {
      if (tag !== "all") {
        const audience = chipText(idea.audienceInterest);
        const alignment = chipText(idea.channelAlignment);
        if (audience !== tag && alignment !== tag) return false;
      }
      if (!needle) return true;
      const haystack = [
        idea.title,
        idea.summary,
        idea.outline ?? "",
        idea.relatedInterest ?? "",
        idea.thumbnailNotes ?? "",
        idea.audienceInterest ?? "",
        idea.channelAlignment ?? "",
        ...idea.suggestedTitles,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [ideas, query, tag]);

  async function handleCopy(id: string, value: string) {
    const ok = await copyText(value);
    if (!ok) return;
    setCopiedId(id);
    window.setTimeout(() => {
      setCopiedId((current) => (current === id ? null : current));
    }, 1600);
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => ({ ...current, [id]: !current[id] }));
  }

  return (
    <div className="inspiration-board">
      <div className="inspiration-toolbar filter-bar is-sticky">
        <label className="inspiration-search">
          Search
          <input
            aria-label="Search inspiration ideas"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Title, outline, titles…"
            type="search"
            value={query}
          />
        </label>
        <label>
          Tag
          <select
            aria-label="Filter by tag"
            onChange={(event) => setTag(event.target.value)}
            value={tag}
          >
            <option value="all">All tags</option>
            {tags.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <span className="list-toolbar-meta">
          {filtered.length} / {ideas.length} ideas
        </span>
        <Link className="button button-ghost" href="/library">
          Generate ideas
        </Link>
        <Link className="button button-secondary" href="/candidates?status=proposed">
          Review queue
        </Link>
      </div>

      {filtered.length === 0 ? (
        <section className="empty-panel">
          <span className="stripe-mark" aria-hidden="true" />
          <h2>No matching ideas</h2>
          <p>Try clearing search or the tag filter.</p>
        </section>
      ) : (
        <section className="inspiration-list" aria-label="Active ideas">
          {filtered.map((idea, index) => {
            const audienceChip = chipText(idea.audienceInterest);
            const alignmentChip = chipText(idea.channelAlignment);
            const open = expanded[idea.id] ?? false;
            const hasDeep =
              Boolean(idea.outline) ||
              Boolean(idea.relatedInterest) ||
              Boolean(idea.thumbnailNotes) ||
              Boolean(
                idea.audienceInterest && !audienceChip,
              ) ||
              Boolean(idea.channelAlignment && !alignmentChip);
            const copyKey = `idea-${idea.id}`;
            const titlesBlob = [
              idea.title,
              ...idea.suggestedTitles,
            ].join("\n");

            return (
              <article className="inspiration-card-rich" key={idea.id}>
                <div className="inspiration-card-top">
                  <span className="inspiration-index" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="inspiration-card-main">
                    {(audienceChip || alignmentChip) && (
                      <div className="chip-row">
                        {audienceChip ? (
                          <span className="chip">{audienceChip}</span>
                        ) : null}
                        {alignmentChip ? (
                          <span className="chip">{alignmentChip}</span>
                        ) : null}
                      </div>
                    )}
                    <h2 className="inspiration-card-title">{idea.title}</h2>
                    <p className="muted inspiration-summary">{idea.summary}</p>
                    <p className="inspiration-meta">
                      Captured {formatListDateTime(new Date(idea.capturedAt))}
                      {idea.suggestedTitles.length > 0
                        ? ` · ${idea.suggestedTitles.length} title ideas`
                        : ""}
                    </p>
                  </div>
                  <div className="inspiration-card-actions">
                    <button
                      className="button button-secondary"
                      onClick={() => handleCopy(copyKey, idea.title)}
                      type="button"
                    >
                      {copiedId === copyKey ? "Copied" : "Copy title"}
                    </button>
                    {idea.suggestedTitles.length > 0 ? (
                      <button
                        className="button button-ghost"
                        onClick={() =>
                          handleCopy(`${copyKey}-all`, titlesBlob)
                        }
                        type="button"
                      >
                        {copiedId === `${copyKey}-all`
                          ? "Copied"
                          : "Copy titles"}
                      </button>
                    ) : null}
                  </div>
                </div>

                {idea.suggestedTitles.length > 0 ? (
                  <div className="inspiration-title-bank" aria-label="Suggested titles">
                    {idea.suggestedTitles.map((title) => (
                      <button
                        className="inspiration-title-chip"
                        key={title}
                        onClick={() =>
                          handleCopy(`${copyKey}-${title}`, title)
                        }
                        title="Copy title"
                        type="button"
                      >
                        {copiedId === `${copyKey}-${title}` ? "Copied" : title}
                      </button>
                    ))}
                  </div>
                ) : null}

                {hasDeep ? (
                  <div className="inspiration-deep">
                    <button
                      className="inspiration-deep-toggle"
                      onClick={() => toggleExpanded(idea.id)}
                      type="button"
                    >
                      {open ? "Hide brief" : "Show brief"}
                    </button>
                    {open ? (
                      <div className="inspiration-deep-body">
                        {idea.outline ? (
                          <div>
                            <h3>Outline</h3>
                            <p>{idea.outline}</p>
                          </div>
                        ) : null}
                        {idea.relatedInterest ? (
                          <div>
                            <h3>Related</h3>
                            <p>{idea.relatedInterest}</p>
                          </div>
                        ) : null}
                        {idea.thumbnailNotes ? (
                          <div>
                            <h3>Thumbnail</h3>
                            <p>{idea.thumbnailNotes}</p>
                          </div>
                        ) : null}
                        {idea.audienceInterest && !audienceChip ? (
                          <div>
                            <h3>Audience</h3>
                            <p>{idea.audienceInterest}</p>
                          </div>
                        ) : null}
                        {idea.channelAlignment && !alignmentChip ? (
                          <div>
                            <h3>Channel alignment</h3>
                            <p>{idea.channelAlignment}</p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
