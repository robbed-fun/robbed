/**
 * Canonical constants shared by indexer, api, and web.
 *
 * Sources (transcribed, not invented):
 * - CLAUDE.md "Chain facts" (chain id, WETH)
 * - docs/developers/contracts.md (on-chain input validation, fees, supply)
 * - docs/developers/api.md, indexer.md (read-API conventions, candles, metadata)
 * - docs/developers/web.md (product limits)
 *
 * Hard rule (no-market-metrics): NO market metrics (prices, TVL, ETH/USD,
 * volumes) may ever live in this file or anywhere else as constants.
 */

/** Robinhood Chain (Arbitrum Orbit) — CLAUDE.md. */
export const CHAIN_ID = 4663;

/** Canonical WETH on chain 4663 — the ONLY address that may be hardcoded (CLAUDE.md). */
export const WETH_ADDRESS = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as const;

/**
 * Canonical Uniswap V3 deployment on Robinhood Chain (chain 4663) — confirmed
 * and recorded in the design decisions log (2026-07-09; closes O-4 /
 * OI-13 / web-11 / E-1). Transcribed VERBATIM — never invented,
 * casing preserved as recorded (also mirrored in M0 `out/constants.json.external`
 * and contracts.md). These are the FIXED external registry addresses (the
 * chain's Uniswap deployment), distinct from the per-deployment robbed contract
 * addresses that M1-14 codegen emits — no overlap; downstream imports here.
 *
 * Deploy-time runtime assertions remain MANDATORY and fail-closed (contracts.md):
 * `factory.feeAmountTickSpacing(10000) == 200`, `NPM.factory() == factory`,
 * `NPM.WETH9() == WETH_ADDRESS`. The indexer asserts each is non-zero at startup.
 */
export const UNISWAP_V3 = {
  factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  positionManager: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3",
  swapRouter02: "0xcaf681a66d020601342297493863e78c959e5cb2",
  quoterV2: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
} as const;

/**
 * Chainlink ETH/USD PROXY on Robinhood Chain 4663 — MAINNET-4663 ONLY.
 * Recorded in the design decisions log (2026-07-11, closes OI-6; live-verified via
 * `eth_call`: `description() == "ETH / USD"`, `decimals() == 8`). Transcribed
 * VERBATIM, casing preserved as recorded; the aggregator behind
 * the proxy is 0x6091E64eb7138EEF066a80FD3A0d7427B91f2721 (informational).
 * The ONLY hex literal for this feed in the repo. This is a feed ADDRESS, not
 * a market metric — the no-hardcoded-metrics rule is untouched: prices are
 * always read live from the feed. LOCAL/TESTNET (non-4663 chains) never use
 * it — they take the documented HTTP fallback (indexer.md), and the
 * poller's `CHAINLINK_ETH_USD_FEED` env override (`off` disables) remains the
 * runtime switch. The consuming poller MUST keep the fail-closed
 * startup assertions (description + decimals) — mirroring the
 * deploy-time assertion discipline above. ABI: abi/external.ts aggregatorV3Abi.
 */
export const CHAINLINK_ETH_USD_PROXY_4663 =
  "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9" as const;

/**
 * The canonical LP sentence — single string constant everywhere, including the
 * Trust panel (CLAUDE.md hard rule). Never "burned".
 *
 * PENDING AMENDMENT (DO NOT flip yet): when the creator-fee factory generation
 * deploys, this becomes
 *   "LP principal permanently locked; trading fees split between treasury and creator."
 * The creator-fee decision is explicit that robbed-shared updates this constant + the
 * copy-lint fixture WITH the generation deploy — NOT before (flipping early would
 * mislabel the still-live treasury-only mainnet copy and break copy-lint). Kept
 * as-is here on purpose; the flip lands when Phase-2 relays the deploy.
 * // TODO(phase2-reconcile): flip LP_COPY + constants.test + web copy-lint fixture
 * // to the wording in lockstep with the creator-fee generation deploy.
 */
export const LP_COPY =
  "LP principal permanently locked; trading fees claimable by treasury." as const;

/** Ratified candle interval set (indexer.md). */
export const CANDLE_INTERVALS = ["1s", "15s", "1m", "5m", "15m", "1h"] as const;
export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

/** Bucket width in seconds per interval (indexer.md bucket_start flooring). */
export const CANDLE_INTERVAL_SECONDS: Record<CandleInterval, number> = {
  "1s": 1,
  "15s": 15,
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
} as const;

/** Max buckets per GET /v1/tokens/:address/candles request (api.md). */
export const MAX_CANDLE_BUCKETS = 5000;

// ── Launch-flow input limits ────────────────────────────────────────────────

/** Image upload cap, bytes ("≤4MB"; api.md). */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * Metadata name/ticker limits are **UTF-8 BYTE** limits (DECIDED,
 * 2026-07-09; findings X-1), NOT character/code-unit limits. They equal the
 * on-chain gate `bytes(name).length ∈ [1,32]` / `bytes(symbol).length ∈ [1,10]`
 * (contracts.md). Enforced via a `TextEncoder` byte-length refinement
 * (`byteBoundedString`, text.ts) — never `.max()`, which counts UTF-16 code
 * units and would let a multibyte name pass the API and then revert at
 * `createToken`. `TextEncoder` emits UTF-8, byte-identical to Solidity
 * `bytes(x).length`, so API acceptance ⇒ on-chain acceptance by construction.
 */
export const METADATA_NAME_MAX = 32;
/** Ticker ≤10 UTF-8 bytes (contracts.md `bytes(symbol).length ∈ [1,10]`). */
export const METADATA_TICKER_MAX = 10;
/** Description ≤500. */
export const METADATA_DESCRIPTION_MAX = 500;
/** metadataUri length validated on-chain in [1,256] (contracts.md). */
export const METADATA_URI_MAX = 256;

/** Canonical metadata JSON fetch cap for the verifier, bytes (indexer.md). */
export const MAX_METADATA_JSON_BYTES = 64 * 1024;

/** Version tag written into every canonical metadata JSON (api.md "fixed field set + version tag"). */
export const METADATA_VERSION = 1;

// ── Read-API conventions (api.md) ──────────────────────────────────

/** Cursor pagination: limit ≤ 100, default 50 (api.md). */
export const PAGE_LIMIT_MAX = 100;
export const PAGE_LIMIT_DEFAULT = 50;

/** Search query length bounds (api.md : "q: 1..80 chars, trimmed"). */
export const SEARCH_QUERY_MIN = 1;
export const SEARCH_QUERY_MAX = 80;

/** USD field staleness threshold: snapshots older than this add `stale: true` (api.md). */
export const USD_STALE_AFTER_SECONDS = 5 * 60;

// ── Token facts (contracts.md) ─────────────────────────────────────────

/** Fixed total supply, wei-denominated: 1,000,000,000e18. */
export const TOTAL_SUPPLY_WEI = 1_000_000_000n * 10n ** 18n;

/** Hard cap on trade fee, basis points ("≤2%"; contracts.md MAX_TRADE_FEE_BPS). */
export const MAX_TRADE_FEE_BPS = 200;

/** Basis-point denominator: 10_000 bps == 100.00%. */
export const BPS_DENOMINATOR = 10_000;

/**
 * Post-graduation V3 fee split — the CREATOR's share, basis points.
 * The graduated position is a full-range V3 **1%-fee** LP; the creator-aware
 * `LPFeeVault.collect(tokenId)` splits the accrued fees 50/50 creator/treasury on
 * BOTH legs (launch-token leg on sells, WETH leg on buys) ⇒ creator 0.5% of volume,
 * treasury 0.5% of volume — venue-invariant with the pre-grad 50-bps creator
 * leg. `5000` (50.00%) is an IMMUTABLE of the vault generation; the
 * treasury share is the remaining `BPS_DENOMINATOR - CREATOR_LP_SHARE_BPS`.
 *
 * // TODO(phase2-reconcile): confirm the exact on-chain immutable name (assumed
 * // `creatorLpShareBps`) and that the split is applied PER LEG
 * // (creator = 50% of amount0 + 50% of amount1; treasury = the remaining 50% of
 * // each) against the final creator-aware LPFeeVault ABI.
 */
export const CREATOR_LP_SHARE_BPS = 5000;

/**
 * Additive trade-fee cap invariant (hard cap / additive split):
 * the curve's treasury trade fee and the creator leg SUM under the hard cap —
 * `tradeFeeBps + creatorFeeBps ≤ MAX_TRADE_FEE_BPS` (200). Mainnet ships
 * `treasuryFeeBps = 100` + `creatorFeeBps = 50` = 150 ≤ 200. The factory
 * constructor/setter re-asserts this on-chain (never caller-supplied); this is
 * the ONE shared predicate every service validates the pair with (anti-drift:
 * computed once, imported — used by the `feePolicySchema` refine in api-types.ts).
 */
export function combinedTradeFeeBps(tradeFeeBps: number, creatorFeeBps: number): number {
  return tradeFeeBps + creatorFeeBps;
}
export function isCombinedTradeFeeWithinCap(tradeFeeBps: number, creatorFeeBps: number): boolean {
  return combinedTradeFeeBps(tradeFeeBps, creatorFeeBps) <= MAX_TRADE_FEE_BPS;
}
