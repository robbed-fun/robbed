/**
 * Token-detail table page sizes (§12.59 — "page size is config, not a magic
 * literal"). Single home for the trades/holders keyset page windows so the
 * DataTable + Pagination never bake a bare number. Kept ≤ the shared
 * `PAGE_LIMIT_MAX` the API clamps to.
 */

/** Trades feed keyset page size (was the historical `limit=50`). */
export const TRADES_PAGE_SIZE = 50;

/** Top-holders keyset page size (was the historical `limit=20`). */
export const HOLDERS_PAGE_SIZE = 20;
