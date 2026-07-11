/**
 * Search query builder (§5.1, api.md §3.3; §12.22 formulas as config). PURE and
 * unit-tested without a DB: given a query string it produces the parameterized
 * SQL + params and a `mode` discriminator. One endpoint covers all four fields
 * (name, ticker, contract address, creator address).
 *
 * Two modes:
 *  - ADDRESS mode (`^0x[0-9a-fA-F]{6,40}$`): prefix/exact LIKE on `address` AND
 *    lowercased `creator`, exact-address row pinned first, then volume tiebreak.
 *  - SIMILARITY mode: trigram `name % q OR ticker % q` (GIN-index eligible) plus
 *    address/creator prefix, ordered by
 *    `GREATEST(similarity(name,q), similarity(ticker,q) × tickerBoost) DESC,
 *     volume_eth_24h DESC`, filtered to a similarity floor.
 *
 * Both modes exclude hidden listings (`visibility IS DISTINCT FROM 'hidden'` so
 * tokens with no moderation row — NULL — remain listed, §12.21). The caller runs
 * the query under `SET LOCAL statement_timeout` (search DoS guard, api.md §6.4).
 */
import type { RankingConfig } from "../config/ranking";
import type { RawQuery } from "../lib/db";
import { confirmationStateSql } from "../lib/confirmation";

export type SearchMode = "address" | "similarity";

/**
 * All four card-projection columns + moderation join, shared by both modes.
 * `confirmation_state` is read-derived from the watermark sidecar (OI-11 /
 * §12.48c — no stored column on Ponder tables).
 */
const SELECT_COLS = `
  t.*, ${confirmationStateSql("t.block_number")} AS confirmation_state,
  m.visibility AS m_visibility, m.impersonation_flag AS m_impersonation_flag,
  m.impersonation_ticker AS m_impersonation_ticker`;
const FROM_JOIN = `
  FROM tokens t
  LEFT JOIN moderation_status m ON m.token_address = t.address`;
const NOT_HIDDEN = `(m.visibility IS DISTINCT FROM 'hidden')`;

const ADDRESS_RE = /^0x[0-9a-fA-F]{6,40}$/;

export function detectMode(q: string): SearchMode {
  return ADDRESS_RE.test(q.trim()) ? "address" : "similarity";
}

export interface BuiltSearch {
  mode: SearchMode;
  query: RawQuery;
}

export function buildSearchQuery(
  qRaw: string,
  limit: number,
  cfg: RankingConfig,
): BuiltSearch {
  const q = qRaw.trim();
  const mode = detectMode(q);

  if (mode === "address") {
    const lower = q.toLowerCase();
    const prefix = `${lower}%`;
    // $1 exact, $2 prefix, $3 limit.
    const text = `
      SELECT ${SELECT_COLS}
      ${FROM_JOIN}
      WHERE (t.address = $1 OR t.address LIKE $2 OR t.creator LIKE $2)
        AND ${NOT_HIDDEN}
      ORDER BY (t.address = $1) DESC, t.volume_eth_24h DESC, t.address ASC
      LIMIT $3`;
    return { mode, query: { text, params: [lower, prefix, limit] } };
  }

  // Similarity mode. $1 = q, $2 = boost, $3 = floor, $4 = prefix, $5 = limit.
  const prefix = `${q.toLowerCase()}%`;
  const text = `
    SELECT ${SELECT_COLS},
      GREATEST(similarity(t.name, $1), similarity(t.ticker, $1) * $2) AS _score
    ${FROM_JOIN}
    WHERE (
        t.name % $1 OR t.ticker % $1
        OR t.address LIKE $4 OR t.creator LIKE $4
      )
      AND ${NOT_HIDDEN}
      AND (
        GREATEST(similarity(t.name, $1), similarity(t.ticker, $1) * $2) >= $3
        OR t.address LIKE $4 OR t.creator LIKE $4
      )
    ORDER BY _score DESC, t.volume_eth_24h DESC, t.address ASC
    LIMIT $5`;
  return {
    mode,
    query: {
      text,
      params: [q, cfg.tickerBoost, cfg.similarityFloor, prefix, limit],
    },
  };
}
