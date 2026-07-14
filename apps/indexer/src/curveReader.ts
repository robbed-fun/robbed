/**
 * Per-curve immutable reader (indexer.md).
 *
 * At `TokenCreated` the indexer reads the freshly-deployed `BondingCurve`'s
 * public immutables straight from chain via viem + the shared `bondingCurveAbi`.
 * This supersedes the M2-4 env interim (`CURVE_SUPPLY_WEI` &c.) now that the
 * read-ABI is in `@robbed/shared/abi` (const-asserted).
 *
 * Why per-curve and NOT `CurveFactory.config()` (the M1-3b / #39
 * divergence): the five curve-shape values (`VIRTUAL_ETH_0`, `VIRTUAL_TOKEN_0`,
 * `CURVE_SUPPLY`, `LP_TOKEN_TRANCHE`, `GRADUATION_ETH`) are `internal immutable`
 * on `CurveFactory` and are NOT surfaced by `config()`; `FactoryConfig` only
 * carries the *factory-current* defaults that govern FUTURE curves. Likewise
 * `TRADE_FEE_BPS` on an older curve differs from the factory's live
 * `tradeFeeBps` after any `setTradeFeeBps` — so the per-token fee MUST come from
 * the curve, never the factory. Reading each curve is the only
 * correct source for a curve created under prior parameters.
 *
 * Cost: `createToken` is low-frequency (not a hot path), so a bounded
 * set of `readContract` calls per creation is acceptable. We use individual
 * reads (Promise.all) rather than `multicall` deliberately: viem `multicall`
 * requires a Multicall3 deployment at the canonical address, whose presence on
 * chain 4663 is unverified. Individual `readContract` calls have no such
 * dependency and cannot silently return a wrong/aggregated value — the boring,
 * can't-corrupt-derived-data choice. Ponder's client caches + dedupes RPC
 * responses at the event's block, so re-delivery/reorg re-reads are cheap.
 *
 * PURE + injectable: the handler passes Ponder's `context.client`; tests pass a
 * stub implementing {@link ContractReader}. The ABI is imported from
 * `@robbed/shared/abi`, never redeclared.
 */
import { bondingCurveAbi } from "@robbed/shared/abi";
import { resilientRead } from "./reads";

/** The exact `BondingCurve` view fns the reader calls (keeps the client type
 *  narrow enough that Ponder's generic `context.client` is assignable — its
 *  `readContract` demands a literal function-name, not `string`). */
export type CurveImmutableFn =
  | "VIRTUAL_ETH_0"
  | "VIRTUAL_TOKEN_0"
  | "CURVE_SUPPLY"
  | "LP_TOKEN_TRANCHE"
  | "GRADUATION_ETH"
  | "TRADE_FEE_BPS"
  | "CREATOR_FEE_BPS";

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
  /** Per-token trade fee (bps) → `tokens.trade_fee_bps` (Trust source). */
  tradeFeeBps: number;
  /**
   * Per-token creator fee (bps) → `tokens.creator_fee_bps`. Read
   * DEFENSIVELY (0 on any failure): a v1 curve predates `CREATOR_FEE_BPS` and its
   * `eth_call` reverts, which must NOT fail token creation — 0 is the v1 value.
   */
  creatorFeeBps: number;
}

/** Per-immutable safe default used when a read cannot be satisfied even at
 *  `latest` (last-resort degradation — see reads.ts). Chosen so the token row
 *  is created rather than the backfill wedging; a reindex on an archive RPC
 *  restores the true value (immutables are value-identical at any block). */
const CURVE_DEFAULTS = {
  VIRTUAL_ETH_0: 0n,
  VIRTUAL_TOKEN_0: 0n,
  CURVE_SUPPLY: 0n,
  LP_TOKEN_TRANCHE: 0n,
  GRADUATION_ETH: 0n,
  TRADE_FEE_BPS: 0,
  // : 0 is ALSO the correct value for a v1 curve whose bytecode lacks the
  // `CREATOR_FEE_BPS` leg (its call reverts — a non-pruned error, defaulted to 0).
  CREATOR_FEE_BPS: 0,
} as const;

/**
 * Read the seven curve immutables from a single `BondingCurve` address.
 *
 * Every read is PRUNE-RESILIENT via the shared `resilientRead` helper (reads.ts):
 * the primary read is the deterministic, Ponder-cached EVENT-BLOCK read
 * (`context.client` — `client` here); when `getLatest` is supplied, a pruned-state
 * failure on a non-archive node degrades to the SAME call at `latest` (immutables
 * are value-identical at any block ≥ creation — `BondingCurve` has no selfdestruct,
 * so block choice is immaterial). If `latest` also fails, or the call reverts for a
 * non-pruned reason (a v1 curve lacking `CREATOR_FEE_BPS`), the read degrades to the
 * per-immutable default — it NEVER throws, so a single failed read cannot wedge the
 * backfill (previously the Promise.all propagated "missing trie node" and Ponder
 * retried-9×-and-wedged). On an ARCHIVE RPC the event-block reads simply succeed and
 * no degradation happens. Decision recorded 2026-07-13; see reads.ts for the basis
 * (viem@2.55.0 BaseError, ponder.sh: `context.client` reads at the event block and
 * rejects `blockTag` overrides — hence the separate `latest` client in latestReader.ts).
 *
 * `getLatest` is a lazy factory so the `latest` viem client is built only when a
 * degradation actually occurs (and never in pure unit tests that omit it).
 */
export async function readCurveImmutables(
  client: ContractReader,
  curveAddress: string,
  getLatest?: () => ContractReader,
): Promise<CurveImmutables> {
  const address = curveAddress.toLowerCase() as `0x${string}`;

  /** Route one immutable read through the shared prune-resilient helper. */
  const read = <T>(functionName: CurveImmutableFn, coerce: (raw: unknown) => T, fallbackValue: T) =>
    resilientRead<T>({
      label: `curve ${address} ${functionName}`,
      atBlock: async () => coerce(await client.readContract({ abi: bondingCurveAbi, address, functionName })),
      atLatest: getLatest
        ? async () => coerce(await getLatest().readContract({ abi: bondingCurveAbi, address, functionName }))
        : undefined,
      fallbackValue,
    });

  // TRADE_FEE_BPS / CREATOR_FEE_BPS are uint16 → viem decodes to number, but
  // coerce defensively (a bigint would violate the integer column contract).
  const asBigint = (raw: unknown) => raw as bigint;
  const asNumber = (raw: unknown) => Number(raw as number | bigint);

  const [virtualEth0, virtualToken0, curveSupply, lpTokenTranche, graduationEth, tradeFeeBps, creatorFeeBps] =
    await Promise.all([
      read("VIRTUAL_ETH_0", asBigint, CURVE_DEFAULTS.VIRTUAL_ETH_0),
      read("VIRTUAL_TOKEN_0", asBigint, CURVE_DEFAULTS.VIRTUAL_TOKEN_0),
      read("CURVE_SUPPLY", asBigint, CURVE_DEFAULTS.CURVE_SUPPLY),
      read("LP_TOKEN_TRANCHE", asBigint, CURVE_DEFAULTS.LP_TOKEN_TRANCHE),
      read("GRADUATION_ETH", asBigint, CURVE_DEFAULTS.GRADUATION_ETH),
      read("TRADE_FEE_BPS", asNumber, CURVE_DEFAULTS.TRADE_FEE_BPS),
      // creator fee — same resilient path: a v1 curve's revert is a
      // non-pruned error → default 0 (its correct value); a pruned node degrades
      // to `latest` like the others.
      read("CREATOR_FEE_BPS", asNumber, CURVE_DEFAULTS.CREATOR_FEE_BPS),
    ]);

  return { virtualEth0, virtualToken0, curveSupply, lpTokenTranche, graduationEth, tradeFeeBps, creatorFeeBps };
}

/**
 * Convenience wrapper preserving the handler call site: event-block reads via
 * `primary` (`context.client`) with `fallback` (`latest`) as the pruned-state
 * degradation target. Thin over `readCurveImmutables(primary, addr, () => fallback)`
 * — the resilience now lives per-read in the shared helper (reads.ts), so no read
 * path (including the recently-added `CREATOR_FEE_BPS`) can bypass the fallback.
 */
export function readCurveImmutablesWithFallback(
  primary: ContractReader,
  fallback: ContractReader,
  curveAddress: string,
): Promise<CurveImmutables> {
  return readCurveImmutables(primary, curveAddress, () => fallback);
}
