/**
 * Canonical event ABI fragments — THE single source for Ponder config
 * (apps/indexer) and frontend decoding (apps/web).
 *
 * Shapes are TRANSCRIBED from the ratified contract designs:
 * - `TokenCreated`  — spec §12.15; docs/services/contracts.md §2.2 (CurveFactory)
 * - `Trade`         — spec §12.15; contracts.md §2.3 (BondingCurve; ethAmount is GROSS, fee separate)
 * - `Graduated`     — contracts.md §2.5 (V3Migrator)
 * - `Transfer`      — canonical ERC-20; sixth indexed event family, sole source of
 *                     holder-balance truth (spec §12.16; indexer.md §3.6)
 * - V3 `Swap`       — canonical Uniswap V3 pool event (indexer.md §3.4)
 * - `Collect`       — canonical Uniswap V3 NonfungiblePositionManager event (indexer.md §3.5)
 *
 * M1 contract artifacts must match these byte-for-byte; any divergence found at
 * implementation time is escalated to hoodpad-architect, never patched around
 * (indexer.md §3, OI-1).
 */

/** spec §12.15 / contracts.md §2.2 — emitted by CurveFactory. */
export const tokenCreatedEvent = {
  type: "event",
  name: "TokenCreated",
  inputs: [
    { name: "token", type: "address", indexed: true },
    { name: "curve", type: "address", indexed: true },
    { name: "creator", type: "address", indexed: true },
    { name: "name", type: "string", indexed: false },
    { name: "symbol", type: "string", indexed: false },
    { name: "metadataHash", type: "bytes32", indexed: false },
    // R2 canonical JSON URL — event-only; the integrity commitment is metadataHash (§8.3)
    { name: "metadataUri", type: "string", indexed: false },
    // V3 pool, pre-created + initialized at creation time (§6.3.2)
    { name: "pool", type: "address", indexed: false },
  ],
} as const;

/**
 * spec §12.15 / contracts.md §2.3 — emitted by each BondingCurve (Ponder
 * factory children via TokenCreated). `ethAmount` is GROSS (fee included);
 * net = ethAmount − fee. Reserve fields are post-trade → zero hot-path RPC reads.
 */
export const tradeEvent = {
  type: "event",
  name: "Trade",
  inputs: [
    { name: "trader", type: "address", indexed: true },
    { name: "isBuy", type: "bool", indexed: true },
    { name: "ethAmount", type: "uint256", indexed: false },
    { name: "tokenAmount", type: "uint256", indexed: false },
    { name: "fee", type: "uint256", indexed: false },
    { name: "virtualEthReserves", type: "uint256", indexed: false },
    { name: "virtualTokenReserves", type: "uint256", indexed: false },
    { name: "realEthReserves", type: "uint256", indexed: false },
  ],
} as const;

/** contracts.md §2.5 — emitted by V3Migrator at graduation (single-fire per token). */
export const graduatedEvent = {
  type: "event",
  name: "Graduated",
  inputs: [
    { name: "token", type: "address", indexed: true },
    { name: "pool", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true },
    { name: "liquidity", type: "uint128", indexed: false },
    { name: "wethInPosition", type: "uint256", indexed: false },
    { name: "tokensInPosition", type: "uint256", indexed: false },
    { name: "graduationFee", type: "uint256", indexed: false },
    { name: "caller", type: "address", indexed: false },
    { name: "callerReward", type: "uint256", indexed: false },
    { name: "tokensBurned", type: "uint256", indexed: false },
    { name: "wethDustToTreasury", type: "uint256", indexed: false },
  ],
} as const;

/**
 * Canonical ERC-20 Transfer — indexed on every LaunchToken (Ponder factory
 * children via TokenCreated). Sixth event family, sole source of holder-balance
 * truth (spec §12.16; indexer.md §3.6).
 */
export const transferEvent = {
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
} as const;

/**
 * Canonical Uniswap V3 pool Swap (stable upstream shape, indexer.md §3.4).
 * Indexed only on graduated pools (Ponder factory over Graduated.pool, §12.16).
 */
export const v3SwapEvent = {
  type: "event",
  name: "Swap",
  inputs: [
    { name: "sender", type: "address", indexed: true },
    { name: "recipient", type: "address", indexed: true },
    { name: "amount0", type: "int256", indexed: false },
    { name: "amount1", type: "int256", indexed: false },
    { name: "sqrtPriceX96", type: "uint160", indexed: false },
    { name: "liquidity", type: "uint128", indexed: false },
    { name: "tick", type: "int24", indexed: false },
  ],
} as const;

/**
 * Canonical Uniswap V3 NonfungiblePositionManager Collect (indexer.md §3.5).
 * Indexed on the NPM (address from config — open item §13), filtered to
 * lp_token_ids held by LPFeeVault. Feeds the treasury fee-accrual dashboard.
 */
export const v3CollectEvent = {
  type: "event",
  name: "Collect",
  inputs: [
    { name: "tokenId", type: "uint256", indexed: true },
    { name: "recipient", type: "address", indexed: false },
    { name: "amount0", type: "uint256", indexed: false },
    { name: "amount1", type: "uint256", indexed: false },
  ],
} as const;

// ── Per-contract groupings (what Ponder registers per source) ───────────────

/** CurveFactory root ABI slice consumed by the indexer. */
export const curveFactoryEventsAbi = [tokenCreatedEvent] as const;

/** BondingCurve (factory children of TokenCreated.curve). */
export const bondingCurveEventsAbi = [tradeEvent] as const;

/** V3Migrator (Graduated source). */
export const v3MigratorEventsAbi = [graduatedEvent] as const;

/** LaunchToken (factory children of TokenCreated.token). */
export const launchTokenEventsAbi = [transferEvent] as const;

/** Uniswap V3 pool (factory children of Graduated.pool). */
export const v3PoolEventsAbi = [v3SwapEvent] as const;

/** Uniswap V3 NonfungiblePositionManager (single source, address from config). */
export const v3PositionManagerEventsAbi = [v3CollectEvent] as const;

/** Everything the indexer consumes, in one artifact (§8, §12.15-16). */
export const robbedEventsAbi = [
  tokenCreatedEvent,
  tradeEvent,
  graduatedEvent,
  transferEvent,
  v3SwapEvent,
  v3CollectEvent,
] as const;
