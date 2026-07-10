/**
 * Per-curve immutable reader (spec §12.38/§12.40d; indexer.md §3.1).
 *
 * At `TokenCreated` the indexer reads the freshly-deployed `BondingCurve`'s
 * public immutables straight from chain via viem + the shared `bondingCurveAbi`.
 * This supersedes the M2-4 env interim (`CURVE_SUPPLY_WEI` &c.) now that the
 * read-ABI is in `@robbed/shared/abi` (const-asserted).
 *
 * Why per-curve and NOT `CurveFactory.config()` (the M1-3b / §12.40 #39
 * divergence): the five curve-shape values (`VIRTUAL_ETH_0`, `VIRTUAL_TOKEN_0`,
 * `CURVE_SUPPLY`, `LP_TOKEN_TRANCHE`, `GRADUATION_ETH`) are `internal immutable`
 * on `CurveFactory` and are NOT surfaced by `config()`; `FactoryConfig` only
 * carries the *factory-current* defaults that govern FUTURE curves. Likewise
 * `TRADE_FEE_BPS` on an older curve differs from the factory's live
 * `tradeFeeBps` after any `setTradeFeeBps` — so the per-token fee MUST come from
 * the curve, never the factory (§12.40d). Reading each curve is the only
 * correct source for a curve created under prior parameters.
 *
 * Cost: `createToken` is low-frequency (not a hot path, §12.40d), so a bounded
 * set of `readContract` calls per creation is acceptable. We use individual
 * reads (Promise.all) rather than `multicall` deliberately: viem `multicall`
 * requires a Multicall3 deployment at the canonical address, whose presence on
 * chain 4663 is unverified (§13). Individual `readContract` calls have no such
 * dependency and cannot silently return a wrong/aggregated value — the boring,
 * can't-corrupt-derived-data choice. Ponder's client caches + dedupes RPC
 * responses at the event's block, so re-delivery/reorg re-reads are cheap.
 *
 * PURE + injectable: the handler passes Ponder's `context.client`; tests pass a
 * stub implementing {@link ContractReader}. The ABI is imported from
 * `@robbed/shared/abi`, never redeclared.
 */
import { bondingCurveAbi } from "@robbed/shared/abi";

/** The exact `BondingCurve` view fns the reader calls (keeps the client type
 *  narrow enough that Ponder's generic `context.client` is assignable — its
 *  `readContract` demands a literal function-name, not `string`). */
export type CurveImmutableFn =
  | "VIRTUAL_ETH_0"
  | "VIRTUAL_TOKEN_0"
  | "CURVE_SUPPLY"
  | "LP_TOKEN_TRANCHE"
  | "GRADUATION_ETH"
  | "TRADE_FEE_BPS";

/**
 * Minimal shape of the viem-style client the reader needs (Ponder's
 * `context.client`, or a test stub). Kept structural so the reader stays a pure,
 * unit-testable unit with no Ponder/viem import surface beyond the ABI.
 */
export interface ContractReader {
  readContract(args: {
    abi: typeof bondingCurveAbi;
    address: `0x${string}`;
    functionName: CurveImmutableFn;
  }): Promise<unknown>;
}

/** The curve deploy immutables the indexer needs at `TokenCreated`. */
export interface CurveImmutables {
  /** Initial virtual ETH reserve → `tokens.virtual_eth`. */
  virtualEth0: bigint;
  /** Initial virtual token reserve → `tokens.virtual_token`. */
  virtualToken0: bigint;
  /** Tokens seeded for sale → `tokens.real_token_reserves` (X-4 seed). */
  curveSupply: bigint;
  /** LP tranche minted at graduation (read for completeness; not persisted). */
  lpTokenTranche: bigint;
  /** ETH raised threshold that triggers graduation → `tokens.graduation_eth`. */
  graduationEth: bigint;
  /** Per-token trade fee (bps) → `tokens.trade_fee_bps` (§12.40d Trust source). */
  tradeFeeBps: number;
}

/**
 * Read the six curve immutables from a single `BondingCurve` address. `client`
 * reads at the current event block by default (Ponder), so the values are the
 * deployed constants (immutables never change — block choice is immaterial, but
 * we rely on the default rather than pinning a block).
 */
export async function readCurveImmutables(
  client: ContractReader,
  curveAddress: string,
): Promise<CurveImmutables> {
  const address = curveAddress.toLowerCase() as `0x${string}`;
  const read = (functionName: CurveImmutableFn) =>
    client.readContract({ abi: bondingCurveAbi, address, functionName });

  const [virtualEth0, virtualToken0, curveSupply, lpTokenTranche, graduationEth, tradeFeeBps] = await Promise.all([
    read("VIRTUAL_ETH_0"),
    read("VIRTUAL_TOKEN_0"),
    read("CURVE_SUPPLY"),
    read("LP_TOKEN_TRANCHE"),
    read("GRADUATION_ETH"),
    read("TRADE_FEE_BPS"),
  ]);

  return {
    virtualEth0: virtualEth0 as bigint,
    virtualToken0: virtualToken0 as bigint,
    curveSupply: curveSupply as bigint,
    lpTokenTranche: lpTokenTranche as bigint,
    graduationEth: graduationEth as bigint,
    // TRADE_FEE_BPS is uint16 → viem decodes to number, but coerce defensively
    // (a bigint would violate the integer column contract).
    tradeFeeBps: Number(tradeFeeBps as number | bigint),
  };
}
