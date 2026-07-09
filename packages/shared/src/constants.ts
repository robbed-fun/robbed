/**
 * Canonical constants shared by indexer, api, and web.
 *
 * Sources (transcribed, not invented):
 * - CLAUDE.md "Chain facts" (chain id, WETH)
 * - launchpad-spec.md §5.3, §12.14, §12.17
 * - docs/services/api.md §3.1-§3.4, §5
 * - docs/services/indexer.md §3, §6.1
 * - docs/services/contracts.md §2.2 (on-chain input validation)
 *
 * Hard rule (spec §2): NO market metrics (prices, TVL, ETH/USD, volumes) may
 * ever live in this file or anywhere else as constants.
 */

/** Robinhood Chain (Arbitrum Orbit) — CLAUDE.md. */
export const CHAIN_ID = 4663;

/** Canonical WETH on chain 4663 — the ONLY address that may be hardcoded (CLAUDE.md). */
export const WETH_ADDRESS = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as const;

/**
 * The canonical LP sentence — single string constant everywhere, including the
 * §5.2 Trust panel (spec §12.14; CLAUDE.md hard rule). Never "burned".
 */
export const LP_COPY =
  "LP principal permanently locked; trading fees claimable by treasury." as const;

/** Ratified candle interval set (spec §12.17; indexer.md §4.1). */
export const CANDLE_INTERVALS = ["1s", "15s", "1m", "5m", "15m", "1h"] as const;
export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

/** Bucket width in seconds per interval (indexer.md §3.7 bucket_start flooring). */
export const CANDLE_INTERVAL_SECONDS: Record<CandleInterval, number> = {
  "1s": 1,
  "15s": 15,
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
} as const;

/** Max buckets per GET /v1/tokens/:address/candles request (api.md §3.4). */
export const MAX_CANDLE_BUCKETS = 5000;

// ── Launch-flow input limits ────────────────────────────────────────────────

/** Image upload cap, bytes (spec §5.3 "≤4MB"; api.md §3.1). */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * Metadata field limits (api.md §3.2 POST /v1/metadata).
 * NOTE (flagged to hoodpad-architect): contracts.md §2.2 validates on-chain
 * `bytes(name).length in [1,32]` while api.md caps name at 64 — see the
 * cross-doc discrepancy report. Values below transcribe api.md verbatim.
 */
export const METADATA_NAME_MAX = 64;
/** Ticker ≤10 (spec §5.3; contracts.md §2.2 validates bytes(symbol).length in [1,10]). */
export const METADATA_TICKER_MAX = 10;
/** Description ≤500 (spec §5.3). */
export const METADATA_DESCRIPTION_MAX = 500;
/** metadataUri length validated on-chain in [1,256] (contracts.md §2.2). */
export const METADATA_URI_MAX = 256;

/** Canonical metadata JSON fetch cap for the verifier, bytes (indexer.md §6.1). */
export const MAX_METADATA_JSON_BYTES = 64 * 1024;

/** Version tag written into every canonical metadata JSON (api.md §3.2 "fixed field set + version tag"). */
export const METADATA_VERSION = 1;

// ── Read-API conventions (api.md §2, §3.3) ──────────────────────────────────

/** Cursor pagination: limit ≤ 100, default 50 (api.md §2). */
export const PAGE_LIMIT_MAX = 100;
export const PAGE_LIMIT_DEFAULT = 50;

/** Search query length bounds (api.md §3.3: "q: 1..80 chars, trimmed"). */
export const SEARCH_QUERY_MIN = 1;
export const SEARCH_QUERY_MAX = 80;

/** USD field staleness threshold: snapshots older than this add `stale: true` (api.md §2). */
export const USD_STALE_AFTER_SECONDS = 5 * 60;

// ── Token facts (contracts.md §2.1) ─────────────────────────────────────────

/** Fixed total supply, wei-denominated: 1,000,000,000e18 (spec §6.1). */
export const TOTAL_SUPPLY_WEI = 1_000_000_000n * 10n ** 18n;

/** Hard cap on trade fee, basis points (spec §6.4 "≤2%"; contracts.md §2.2 MAX_TRADE_FEE_BPS). */
export const MAX_TRADE_FEE_BPS = 200;
