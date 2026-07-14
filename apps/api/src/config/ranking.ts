/**
 * Ranking / search tuning — the ratified DEFAULTS as TUNABLE CONFIG, not
 * inline magic numbers (api.md, decide-it-yourself). Overridable via
 * env for beta tuning; never market metrics — these are ranking knobs.
 */
export interface RankingConfig {
  /** Ticker similarity boost (×1.2). */
  tickerBoost: number;
  /** Trigram similarity floor for similarity-mode search (0.25). */
  similarityFloor: number;
  /** Search statement timeout, ms (api.md search DoS). */
  searchStatementTimeoutMs: number;
  /** trending = vol24h × e^(−ageHours / trendingHalfLifeHours) (24h). */
  trendingHalfLifeHours: number;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function loadRankingConfig(): RankingConfig {
  return {
    tickerBoost: num("RANK_TICKER_BOOST", 1.2),
    similarityFloor: num("RANK_SIMILARITY_FLOOR", 0.25),
    searchStatementTimeoutMs: num("SEARCH_STATEMENT_TIMEOUT_MS", 2000),
    trendingHalfLifeHours: num("RANK_TRENDING_HALFLIFE_HOURS", 24),
  };
}

export const DEFAULT_RANKING = loadRankingConfig();
