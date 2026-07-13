/**
 * Canonical constants shared by indexer, api, and web.
 *
 * Sources (transcribed, not invented):
 * - CLAUDE.md "Chain facts" (chain id, WETH)
 * - docs/spec.md §5.3, §12.14, §12.17
 * - docs/developers/api.md §3.1-§3.4, §5
 * - docs/developers/indexer.md §3, §6.1
 * - docs/developers/contracts.md §2.2 (on-chain input validation)
 *
 * Hard rule (spec §2): NO market metrics (prices, TVL, ETH/USD, volumes) may
 * ever live in this file or anywhere else as constants.
 */

/** Robinhood Chain (Arbitrum Orbit) — CLAUDE.md. */
export const CHAIN_ID = 4663;

/** Canonical WETH on chain 4663 — the ONLY address that may be hardcoded (CLAUDE.md). */
export const WETH_ADDRESS = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as const;

/**
 * Canonical Uniswap V3 deployment on Robinhood Chain (chain 4663) — confirmed
 * and recorded as source of truth in spec §12.28 (2026-07-09; closes O-4 /
 * OI-13 / web-11 / E-1). Transcribed VERBATIM from §12.28 — never invented,
 * casing preserved as recorded (also mirrored in M0 `out/constants.json.external`
 * and contracts.md §4). These are the FIXED external registry addresses (the
 * chain's Uniswap deployment), distinct from the per-deployment robbed contract
 * addresses that M1-14 codegen emits — no overlap; downstream imports here.
 *
 * Deploy-time runtime assertions remain MANDATORY and fail-closed (contracts.md
 * §7.2): `factory.feeAmountTickSpacing(10000) == 200`, `NPM.factory() == factory`,
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
 * Recorded in spec §12.51 (2026-07-11, closes §13 OI-6; live-verified via
 * `eth_call`: `description() == "ETH / USD"`, `decimals() == 8`). Transcribed
 * VERBATIM from §12.51, casing preserved as recorded; the aggregator behind
 * the proxy is 0x6091E64eb7138EEF066a80FD3A0d7427B91f2721 (informational).
 * The ONLY hex literal for this feed in the repo. This is a feed ADDRESS, not
 * a market metric — the §2 no-hardcoded-metrics rule is untouched: prices are
 * always read live from the feed. LOCAL/TESTNET (non-4663 chains) never use
 * it — they take the documented HTTP fallback (indexer.md §3.9), and the
 * poller's `CHAINLINK_ETH_USD_FEED` env override (`off` disables) remains the
 * runtime switch. The consuming poller MUST keep the §12.51 fail-closed
 * startup assertions (description + decimals) — mirroring the §12.28
 * deploy-time assertion discipline above. ABI: abi/external.ts aggregatorV3Abi.
 */
export const CHAINLINK_ETH_USD_PROXY_4663 =
  "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9" as const;

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
 * Metadata name/ticker limits are **UTF-8 BYTE** limits (§12.30 DECIDED,
 * 2026-07-09; findings X-1), NOT character/code-unit limits. They equal the
 * on-chain gate `bytes(name).length ∈ [1,32]` / `bytes(symbol).length ∈ [1,10]`
 * (contracts.md §2.2). Enforced via a `TextEncoder` byte-length refinement
 * (`byteBoundedString`, text.ts) — never `.max()`, which counts UTF-16 code
 * units and would let a multibyte name pass the API and then revert at
 * `createToken`. `TextEncoder` emits UTF-8, byte-identical to Solidity
 * `bytes(x).length`, so API acceptance ⇒ on-chain acceptance by construction.
 */
export const METADATA_NAME_MAX = 32;
/** Ticker ≤10 UTF-8 bytes (§12.30; contracts.md §2.2 `bytes(symbol).length ∈ [1,10]`). */
export const METADATA_TICKER_MAX = 10;
/** Description ≤500 (spec §5.3). */
export const METADATA_DESCRIPTION_MAX = 500;
/** metadataUri length validated on-chain in [1,256] (contracts.md §2.2). */
export const METADATA_URI_MAX = 256;

/** Canonical metadata JSON fetch cap for the verifier, bytes (indexer.md §6.1). */
export const MAX_METADATA_JSON_BYTES = 64 * 1024;

/** Version tag written into every canonical metadata JSON (api.md §3.2 "fixed field set + version tag"). */
export const METADATA_VERSION = 1;

// ── Comments (Phase-2 "final version" — off-chain, SIWE-authored; spec §12.63b) ─

/**
 * Off-chain comment body cap, UTF-16 code units. Spec §12.63(b) scopes comments
 * but does NOT fix a body length, so this is a product-tunable DEFAULT recorded
 * here (never inlined — §2), enforced everywhere via the shared `commentBodySchema`
 * (ws-messages.ts). Value mirrors the §5.3 metadata `description` cap (500) as the
 * sane default for a single free-text field. Code-unit `.max()` — NOT a byte cap
 * like metadata name/ticker (those mirror an on-chain gate; a comment never touches
 * chain). FLAGGED for architect/§13: the final cap (and any rate-limit fields) is a
 * product/anti-abuse knob, retunable like §12.32 — this is not a spec number.
 */
export const COMMENT_BODY_MAX = 500;

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
