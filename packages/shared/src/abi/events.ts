/**
 * Canonical event ABI fragments — THE single source for Ponder config
 * (apps/indexer) and frontend decoding (apps/web).
 *
 * Shapes are TRANSCRIBED from the ratified contract designs:
 * - `TokenCreated` —; docs/developers/contracts.md (CurveFactory)
 * - `Trade` —; contracts.md (BondingCurve; ethAmount is GROSS, fee separate)
 * - `Graduated` — contracts.md (V3Migrator)
 * - `Transfer`      — canonical ERC-20; sixth indexed event family, sole source of
 * holder-balance truth (indexer.md)
 * - V3 `Swap` — canonical Uniswap V3 pool event (indexer.md)
 * - `Collect` — canonical Uniswap V3 NonfungiblePositionManager event (indexer.md)
 *
 * M1 contract artifacts must match these byte-for-byte; any divergence found at
 * implementation time is escalated to robbed-architect, never patched around
 * (indexer.md, OI-1).
 */

/** / contracts.md — emitted by CurveFactory. */
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
    // R2 canonical JSON URL; event copy of LaunchToken.tokenURI().
    { name: "metadataUri", type: "string", indexed: false },
    // V3 pool, pre-created + initialized at creation time
    { name: "pool", type: "address", indexed: false },
  ],
} as const;

/**
 * / contracts.md — emitted by each BondingCurve (Ponder
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

/** contracts.md — emitted by V3Migrator at graduation (single-fire per token). */
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
 * truth (indexer.md).
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
 * Canonical Uniswap V3 pool Swap (stable upstream shape, indexer.md).
 * Indexed only on graduated pools (Ponder factory over Graduated.pool).
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
 * Canonical Uniswap V3 NonfungiblePositionManager Collect (indexer.md).
 * Indexed on the NPM (address from config — open item), filtered to
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

// ── Creator-fee event family (ADDITIVE, Phase-2 fold-in) ──
//
// Distinct from the six ratified families above: these are the
// creator-fee leg (new CurveFactory + BondingCurve + Router + pull-payment
// CreatorVault). TRANSCRIBED byte-for-byte from the landed contract artifacts
// (contracts/out/{BondingCurve,CreatorVault}.sol; interfaces IBondingCurve /
// ICreatorVault) — never invented. They are NOT added to `robbedEventsAbi` or
// `bondingCurveEventsAbi` (which stay the frozen six families — abi.test.ts);
// the indexer registers them via the dedicated groupings below so the ratified
// set and the additive set can't be conflated.
//
// DOC-LOCKSTEP (report) the owning design doc (contracts.md) still
// describes v1 (`creatorFeeBps ≡ 0`, no CreatorVault) — robbed-contracts must
// document this surface there (docs-precede-code). This mirror tracks the
// already-landed contracts; the shapes here are the compiled truth.

/** IBondingCurve — a curve pushed its accrued creator-fee leg to the vault. */
export const creatorFeesSweptEvent = {
  type: "event",
  name: "CreatorFeesSwept",
  inputs: [
    { name: "creator", type: "address", indexed: true },
    { name: "vault", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ],
} as const;

/** ICreatorVault — a curve credited `creator`'s claimable balance (the sweep landing). */
export const creatorFeeDepositedEvent = {
  type: "event",
  name: "CreatorFeeDeposited",
  inputs: [
    { name: "creator", type: "address", indexed: true },
    { name: "curve", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ],
} as const;

/** ICreatorVault — `caller` paid out `creator`'s full accrued balance to the creator. */
export const creatorFeeClaimedEvent = {
  type: "event",
  name: "CreatorFeeClaimed",
  inputs: [
    { name: "creator", type: "address", indexed: true },
    { name: "caller", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
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

/** Everything the indexer consumes, in one artifact. */
export const robbedEventsAbi = [
  tokenCreatedEvent,
  tradeEvent,
  graduatedEvent,
  transferEvent,
  v3SwapEvent,
  v3CollectEvent,
] as const;

// ── Creator-fee groupings (what the indexer registers for the leg) ──
// Kept SEPARATE from the frozen six-family groupings above so `robbedEventsAbi`
// stays the ratified set. robbed-indexer registers `CreatorFeesSwept`
// on the existing BondingCurve source (merge with `bondingCurveEventsAbi`) and a
// NEW CreatorVault Ponder source (`getDeployment(chainId).robbed.creatorVault`,
// present once a creator-fee factory is deployed) with `creatorVaultEventsAbi`.

/** BondingCurve creator-leg slice — merge with `bondingCurveEventsAbi` on the curve source. */
export const bondingCurveCreatorEventsAbi = [creatorFeesSweptEvent] as const;

/** CreatorVault — new Ponder source; address from the deployment registry. */
export const creatorVaultEventsAbi = [
  creatorFeeDepositedEvent,
  creatorFeeClaimedEvent,
] as const;

/** The full additive creator-fee event manifest (parallels `robbedEventsAbi`). */
export const creatorFeeEventsAbi = [
  creatorFeesSweptEvent,
  creatorFeeDepositedEvent,
  creatorFeeClaimedEvent,
] as const;

// ── Post-graduation 50/50 LP-fee-split event family (LANDED) ───
//
// The POST-GRAD half of the creator leg (is the pre-grad half). TRANSCRIBED
// byte-for-byte from the regenerated Phase-2 artifacts (contracts/out/{LPFeeVault,
// CreatorVault}.sol → packages/shared/src/abi/{LPFeeVault,CreatorVault}.json) after
// `bun contracts/script/codegen-abi.ts` — never invented. Custody is Option B
// : the creator-aware `LPFeeVault.collect(tokenId)` splits the V3 pool's
// 1% fees 50/50 (`creatorLpShareBps() == 5000`), treasury share PUSHED to the fixed
// treasury, creator share routed to the pull-payment CreatorVault as a per-`(creator,
// token)` ERC20 balance via `depositERC20(creator, token, share)` — token ∈ {launch
// token, WETH}, NOT unwrapped to ETH. Claimed per ERC20 via `claimERC20(creator,
// token)`; the pre-grad native-ETH leg (`CreatorFeeDeposited`/`Claimed`) stays SEPARATE.
//
// Kept OFF the frozen six-family groupings AND off the pre-grad groupings so
// each set stays independently assertable (abi.test.ts). robbed-indexer registers
// `FeesSplit` on the LPFeeVault source and the two `CreatorToken*` events on the
// existing CreatorVault source (merge with `creatorVaultEventsAbi`).

/**
 * LPFeeVault — the 50/50 split emitted at `collect()`. Per-beneficiary
 * per-leg amounts (`treasury{0,1}`/`creator{0,1}` in RAW pool ordering; the indexer
 * resolves 0/1 → token/weth via `graduations.token_is_token0`). `FeesCollected`
 * (tokenId, amount0, amount1) ALSO still emits — the pre-split harvest total.
 */
export const feesSplitEvent = {
  type: "event",
  name: "FeesSplit",
  inputs: [
    { name: "tokenId", type: "uint256", indexed: true },
    { name: "creator", type: "address", indexed: true },
    { name: "treasury0", type: "uint256", indexed: false },
    { name: "creator0", type: "uint256", indexed: false },
    { name: "treasury1", type: "uint256", indexed: false },
    { name: "creator1", type: "uint256", indexed: false },
  ],
} as const;

/**
 * CreatorVault — post-grad ERC20 leg credited per `(creator, token)`.
 * `token` is the ERC20 (a graduated launch token OR canonical WETH); `source` is the
 * depositor (the LPFeeVault). Distinct from the pre-grad `CreatorFeeDeposited`
 * (per-creator native ETH from a curve).
 */
export const creatorTokenDepositedEvent = {
  type: "event",
  name: "CreatorTokenDeposited",
  inputs: [
    { name: "creator", type: "address", indexed: true },
    { name: "token", type: "address", indexed: true },
    { name: "source", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ],
} as const;

/** CreatorVault — `caller` paid out `creator`'s ERC20 `token` balance (`claimERC20`). */
export const creatorTokenClaimedEvent = {
  type: "event",
  name: "CreatorTokenClaimed",
  inputs: [
    { name: "creator", type: "address", indexed: true },
    { name: "token", type: "address", indexed: true },
    { name: "caller", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ],
} as const;

/** LPFeeVault post-grad split slice — registered on the LPFeeVault source. */
export const lpFeeVaultSplitEventsAbi = [feesSplitEvent] as const;

/** CreatorVault post-grad ERC20 leg — merge with `creatorVaultEventsAbi` on the vault source. */
export const creatorVaultTokenEventsAbi = [creatorTokenDepositedEvent, creatorTokenClaimedEvent] as const;

/** The full additive post-grad creator-split manifest (parallels `creatorFeeEventsAbi`). */
export const postGradCreatorFeeEventsAbi = [
  feesSplitEvent,
  creatorTokenDepositedEvent,
  creatorTokenClaimedEvent,
] as const;
