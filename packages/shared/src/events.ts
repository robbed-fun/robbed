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
