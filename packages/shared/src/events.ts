/**
 * Decoded on-chain event field structs (api.md §5 `events.ts` row) — mirror
 * the canonical ABI fragments in `./abi/events.ts` (spec §12.15-16;
 * contracts.md §2). Consumed by the indexer and tests.
 *
 * Conventions: `bigint` for all uint/int Solidity types, `0x${string}` for
 * addresses/bytes32, `string` for Solidity strings, `boolean` for bool.
 */

export type Address = `0x${string}`;
export type Hex32 = `0x${string}`;

/** spec §12.15 / contracts.md §2.2 — CurveFactory. */
export interface TokenCreatedEvent {
  token: Address;
  curve: Address;
  creator: Address;
  name: string;
  symbol: string;
  metadataHash: Hex32;
  /** R2 canonical JSON URL — event-only; the commitment is metadataHash (§8.3). */
  metadataUri: string;
  /** V3 pool, pre-created + initialized at creation time (§6.3.2). */
  pool: Address;
}

/**
 * spec §12.15 / contracts.md §2.3 — BondingCurve.
 * `ethAmount` is GROSS (fee included); net = ethAmount − fee.
 * Reserve fields are post-trade.
 */
export interface TradeEvent {
  trader: Address;
  isBuy: boolean;
  ethAmount: bigint;
  tokenAmount: bigint;
  fee: bigint;
  virtualEthReserves: bigint;
  virtualTokenReserves: bigint;
  realEthReserves: bigint;
}

/** contracts.md §2.5 — V3Migrator (single-fire per token). */
export interface GraduatedEvent {
  token: Address;
  pool: Address;
  tokenId: bigint;
  liquidity: bigint;
  wethInPosition: bigint;
  tokensInPosition: bigint;
  graduationFee: bigint;
  caller: Address;
  callerReward: bigint;
  tokensBurned: bigint;
  wethDustToTreasury: bigint;
}

/** Canonical ERC-20 Transfer — LaunchToken, sixth event family (spec §12.16). */
export interface TransferEvent {
  from: Address;
  to: Address;
  value: bigint;
}

/** Canonical Uniswap V3 pool Swap (indexer.md §3.4; graduated pools only). */
export interface V3SwapEvent {
  sender: Address;
  recipient: Address;
  amount0: bigint;
  amount1: bigint;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
}

/** Canonical Uniswap V3 NPM Collect (indexer.md §3.5; LPFeeVault positions). */
export interface V3CollectEvent {
  tokenId: bigint;
  recipient: Address;
  amount0: bigint;
  amount1: bigint;
}

// ── Creator-fee leg decoded structs (spec §7 / §12.63 — ADDITIVE) ───────────
// Mirror the creator-fee fragments in `./abi/events.ts` (transcribed from the
// landed BondingCurve/CreatorVault artifacts). Phase-2 fold-in, distinct from
// the six ratified §12.15-16 families above; the indexer's creator-fee handlers
// type their decoded args with these.

/** IBondingCurve (§12.63) — `amount` wei of the creator-fee leg pushed to `vault` for `creator`. */
export interface CreatorFeesSweptEvent {
  creator: Address;
  vault: Address;
  amount: bigint;
}

/** ICreatorVault (§12.63) — `curve` credited `creator`'s claimable balance by `amount` wei. */
export interface CreatorFeeDepositedEvent {
  creator: Address;
  curve: Address;
  amount: bigint;
}

/** ICreatorVault (§12.63) — `caller` paid out `amount` wei of `creator`'s balance to `creator`. */
export interface CreatorFeeClaimedEvent {
  creator: Address;
  caller: Address;
  amount: bigint;
}

// ── Post-graduation 50/50 LP-fee-split decoded structs (spec §12.69 — LANDED) ─
// Mirror the §12.69 fragments in `./abi/events.ts` (transcribed byte-for-byte from
// the regenerated Phase-2 artifacts). Custody is Option B: the creator share is a
// per-`(creator, token)` ERC20 balance in the CreatorVault (`token` ∈ {launch token,
// WETH}, NOT unwrapped to ETH); claimed per ERC20 via `claimERC20(creator, token)`,
// read live via `tokenBalanceOf(creator, token)`. The pre-grad native-ETH family
// (`CreatorFeeDeposited`/`CreatorFeeClaimed`) stays separate. The indexer's post-grad
// handlers type their decoded args with these.

/**
 * LPFeeVault (§12.69) — the 50/50 split emitted at `collect()`. Per-beneficiary
 * per-leg amounts in RAW pool ordering (`treasury0`/`creator0` = leg0, etc.); the
 * indexer resolves 0/1 → token/weth via `graduations.token_is_token0`. Invariant
 * (§12.69(F)(i)): `creator0 + treasury0` and `creator1 + treasury1` each sum to the
 * corresponding `FeesCollected` leg total — no leakage.
 */
export interface FeesSplitEvent {
  tokenId: bigint;
  creator: Address;
  treasury0: bigint;
  creator0: bigint;
  treasury1: bigint;
  creator1: bigint;
}

/**
 * CreatorVault (§12.69) — post-grad ERC20 leg credited per `(creator, token)`.
 * `token` is the ERC20 (a graduated launch token OR canonical WETH); `source` is the
 * depositor (the LPFeeVault). Distinct from the pre-grad `CreatorFeeDeposited`
 * (per-creator native ETH from a curve).
 */
export interface CreatorTokenDepositedEvent {
  creator: Address;
  token: Address;
  source: Address;
  amount: bigint;
}

/** CreatorVault (§12.69) — `caller` paid out `creator`'s ERC20 `token` balance (`claimERC20`). */
export interface CreatorTokenClaimedEvent {
  creator: Address;
  token: Address;
  caller: Address;
  amount: bigint;
}
