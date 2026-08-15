export type InspirationConfig = {
  matchMin: number;
  scoreBoost: number;
  quotaRatio: number;
  staleDays: number;
  generateFillMax: number;
  /** Max Inspiration cards to scroll-load + capture per sync. */
  scrapeMax: number;
};

export function parseInspirationConfig(
  env: Record<string, string | undefined>,
): InspirationConfig {
  return {
    matchMin: parseEnvNumber(env.INSPIRATION_MATCH_MIN, 0.25),
    scoreBoost: parseEnvNumber(env.INSPIRATION_SCORE_BOOST, 0.12),
    quotaRatio: parseEnvNumber(env.INSPIRATION_QUOTA_RATIO, 0.4),
    staleDays: parseEnvInt(env.INSPIRATION_STALE_DAYS, 7),
    generateFillMax: parseEnvInt(env.INSPIRATION_GENERATE_FILL_MAX, 3),
    scrapeMax: Math.max(1, parseEnvInt(env.INSPIRATION_SCRAPE_MAX, 80)),
  };
}

function parseEnvNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEnvInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
