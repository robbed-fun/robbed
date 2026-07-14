/**
 * Token-list sort definitions (sorts; formulas as config). SINGLE
 * source for the ORDER BY expression AND the JS cursor-key computation so the
 * keyset cursor (pagination.ts) can never disagree with the DB ordering.
 *
 * Ordering is `<expr> DESC, t.address DESC` with a row-value keyset
 * `(<expr>, t.address) < ($k, $i)` — stable under inserts, O(1) (decide-it-
 * yourself: keyset over OFFSET).
 *
 * `graduation_eth` is a factory immutable identical across tokens, so `progress`
 * order == `real_eth_reserves` order; `mcap` order == `last_price_eth` order
 * because total supply is fixed. trending = vol24h × e^(−age/halflife).
 */
import type { TokenListRow } from "../lib/db";
import type { RankingConfig } from "../config/ranking";

export type TokenSort = "trending" | "newest" | "mcap" | "volume24h" | "progress";

export interface SortDef {
  /** SQL expression ordered DESC (uses bind params `$now`,`$halflife` for trending). */
  orderExpr: string;
  /** Postgres cast applied to the cursor sort-key param in the keyset compare. */
  castType: "bigint" | "numeric" | "double precision";
}

export function sortDef(sort: TokenSort): SortDef {
  switch (sort) {
    case "newest":
      return { orderExpr: "t.created_at", castType: "bigint" };
    case "mcap":
      return { orderExpr: "COALESCE(t.last_price_eth, 0)", castType: "double precision" };
    case "volume24h":
      return { orderExpr: "t.volume_eth_24h", castType: "numeric" };
    case "progress":
      return { orderExpr: "t.real_eth_reserves", castType: "numeric" };
    case "trending":
      return {
        orderExpr:
          "(t.volume_eth_24h::double precision) * exp(-((($now)::double precision) - t.created_at) / (($halflife)::double precision))",
        castType: "double precision",
      };
  }
}

/** Cursor sort-key value for the LAST row — must equal the DB order expression. */
export function sortKeyForRow(
  sort: TokenSort,
  row: TokenListRow,
  nowSec: number,
  cfg: RankingConfig,
): string {
  switch (sort) {
    case "newest":
      return String(row.created_at);
    case "mcap":
      return String(row.last_price_eth ?? 0);
    case "volume24h":
      return row.volume_eth_24h;
    case "progress":
      return row.real_eth_reserves;
    case "trending": {
      const halflifeSec = cfg.trendingHalfLifeHours * 3600;
      const ageSec = nowSec - row.created_at;
      const score = Number(row.volume_eth_24h) * Math.exp(-ageSec / halflifeSec);
      return String(score);
    }
  }
}
