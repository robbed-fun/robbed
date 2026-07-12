/**
 * Server-side sort + keyset composition for the token-detail TRADES and HOLDERS
 * tables (spec §12.59; api.md §3.4). This module is the ORDER BY SECURITY
 * BOUNDARY: the sort-field enums are validated in `@robbed/shared`
 * (`TRADE_SORT_FIELDS` / `HOLDER_SORT_FIELDS`), and here each enum member maps to
 * a FIXED SQL column expression. A caller string never reaches ORDER BY — the
 * route rejects out-of-allowlist values with 400 before this map is consulted,
 * and even if it didn't, only these hardcoded identifiers can be selected.
 *
 * The runtime column map stays API-local by design (robbed-shared §12.59 report:
 * "one consumer — the SQL builder"; §12.40c single-consumer precedent). The
 * cursor-key extractors + the label ordering also live here so the DB SQL builder
 * (db.bun.ts) and the in-memory test fake (test/helpers.ts) build against ONE
 * definition and cannot drift.
 *
 * Keyset composition (decide-it-yourself, basis recorded): a Postgres row-value
 * comparison `(sort_col, tiebreak) < (k, i)` for `desc` / `> (k, i)` for `asc`.
 * Row-value comparison requires BOTH members to sort in the same direction, so
 * the tiebreak always takes the active `dir` — this is why one operator + one
 * ORDER BY direction covers the whole compound key. Stable under concurrent
 * inserts and O(1) vs OFFSET (same rationale as pagination.ts / search/sort.ts).
 */
import type {
  HolderSortField,
  SortDir,
  TradeRowDb,
  TradeSortField,
} from "@robbed/shared";

/** A sort target: the FIXED SQL expression + the cast applied to the keyset `$k` param. */
export interface SortColumn {
  /** Hardcoded SQL expression — NEVER interpolated from caller input. */
  expr: string;
  /** Postgres cast applied to the cursor sort-key param in the row-value compare. */
  cast: "bigint" | "numeric" | "double precision" | "boolean" | "text" | "int";
}

// ── Trades (GET /v1/tokens/:address/trades) ─────────────────────────────────
//
// enum → fixed `trades` column (indexer.md §3.2; ponder.schema trades table).
// Tiebreak for every trade sort is the row `id` (`${tx_hash}-${log_index}`).
export const TRADE_SORT_COLUMNS: Record<TradeSortField, SortColumn> = {
  age: { expr: "block_timestamp", cast: "bigint" },
  side: { expr: "is_buy", cast: "boolean" },
  trader: { expr: "trader", cast: "text" },
  amount: { expr: "eth_amount::numeric", cast: "numeric" },
  price: { expr: "price_eth", cast: "double precision" },
};
export const TRADE_TIEBREAK = "id";
export const TRADE_SORT_DEFAULT: TradeSortField = "age";
export const TRADE_DIR_DEFAULT: SortDir = "desc";

/**
 * The active sort column's value on a trade row, in the string transport form the
 * signed cursor carries (`KeysetCursorPayload.k`). MUST agree with the SQL column
 * `TRADE_SORT_COLUMNS[field].expr` selects.
 */
export function tradeSortKey(field: TradeSortField, row: TradeRowDb): string {
  switch (field) {
    case "age":
      return String(row.block_timestamp);
    case "side":
      return String(row.is_buy); // "true" | "false" (cast ::boolean in the compare)
    case "trader":
      return row.trader;
    case "amount":
      return row.eth_amount; // wei decimal string (cast ::numeric)
    case "price":
      return String(row.price_eth);
  }
}

// ── Holders (GET /v1/tokens/:address/holders) ───────────────────────────────
//
// enum → fixed column. rank/amount/percent all resolve to `balance::numeric`
// (per-token total supply is constant ⇒ percent order == balance order == rank
// order — distinct UI columns, one physical sort key). `label` sorts by a
// deterministic role/flag CASE (see `holderLabelRank`), materialized as the
// `label_rank` column in the holders CTE. Tiebreak for every holder sort is the
// `holder` address.
export const HOLDER_SORT_COLUMNS: Record<HolderSortField, SortColumn> = {
  rank: { expr: "balance::numeric", cast: "numeric" },
  amount: { expr: "balance::numeric", cast: "numeric" },
  percent: { expr: "balance::numeric", cast: "numeric" },
  address: { expr: "holder", cast: "text" },
  label: { expr: "label_rank", cast: "int" },
};
export const HOLDER_TIEBREAK = "holder";
/** Default rank ≡ balance (spec §12.59: "amount DESC ≡ rank ASC" — biggest first). */
export const HOLDER_SORT_DEFAULT: HolderSortField = "rank";
export const HOLDER_DIR_DEFAULT: SortDir = "desc";

/**
 * The label sort's deterministic ordering (spec §12.58 row-shape `label`). Lower
 * rank sorts first under `desc`... no: it is a plain integer key ordered by the
 * active `dir` like any other column. The GROUPING is what matters and it is
 * fixed here: protocol accounts first (bonding curve, creator, LP pool, vault),
 * then §8.5 bot-flagged holders, then unlabeled. This function is the SINGLE
 * source; the SQL CASE in db.bun.ts and the test fake both reproduce these exact
 * integers — a change here is a change in both by construction (drift guard).
 */
export interface HolderLabelInput {
  holder: string;
  /** §8.5 advisory bot flags, if the address carries any. */
  botFlags?: readonly string[] | null;
}
export interface HolderSpecialAddresses {
  creator: string;
  curve: string;
  pool: string | null;
  /** Treasury / LPFeeVault addresses (config), lowercased. */
  vaults: Set<string>;
}
export function holderLabelRank(
  row: HolderLabelInput,
  special: HolderSpecialAddresses,
): number {
  const addr = row.holder.toLowerCase();
  if (addr === special.curve.toLowerCase()) return 0; // Bonding curve
  if (addr === special.creator.toLowerCase()) return 1; // Creator
  if (special.pool && addr === special.pool.toLowerCase()) return 2; // LP pool
  if (special.vaults.has(addr)) return 3; // Vault
  if (row.botFlags && row.botFlags.length > 0) return 4; // §8.5 flagged
  return 5; // unlabeled
}

/**
 * Holder-row shape the cursor-key extractor needs: the balance + holder (physical
 * columns) plus the two DERIVED columns the query materializes (`rank` from
 * ROW_NUMBER, `label_rank` from the CASE). Kept minimal so both db.bun.ts rows
 * and the fake satisfy it.
 */
export interface HolderSortRow {
  holder: string;
  balance: string;
  rank: number;
  label_rank: number;
}
export function holderSortKey(field: HolderSortField, row: HolderSortRow): string {
  switch (field) {
    case "rank":
    case "amount":
    case "percent":
      return row.balance; // wei decimal string (cast ::numeric)
    case "address":
      return row.holder;
    case "label":
      return String(row.label_rank);
  }
}

// ── SQL fragment helpers (shared by db.bun.ts; unit-tested in isolation) ─────

/** DESC → `<` (walk down), ASC → `>` (walk up). */
export function keysetOp(dir: SortDir): "<" | ">" {
  return dir === "desc" ? "<" : ">";
}

/** `<expr> DESC, <tiebreak> DESC` — one direction across the whole compound key. */
export function orderByClause(expr: string, tiebreak: string, dir: SortDir): string {
  const d = dir === "desc" ? "DESC" : "ASC";
  return `${expr} ${d}, ${tiebreak} ${d}`;
}

/**
 * Row-value keyset predicate `(<expr>, <tiebreak>) <op> ($kIdx::cast, $iIdx)`.
 * The `$k`/`$i` placeholders are caller-supplied (1-based param indexes); the
 * column identifiers come only from the fixed maps above.
 */
export function keysetPredicate(
  col: SortColumn,
  tiebreak: string,
  dir: SortDir,
  kParamIndex: number,
  iParamIndex: number,
): string {
  return `(${col.expr}, ${tiebreak}) ${keysetOp(dir)} ($${kParamIndex}::${col.cast}, $${iParamIndex})`;
}
