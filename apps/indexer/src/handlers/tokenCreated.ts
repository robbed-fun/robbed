/**
 * TokenCreated handler (indexer.md §3.1, M2-5 sub-task 5a).
 *
 * Seeds the `tokens` row: `creator` + `creator_fee_bps=0` from day 1 (§7);
 * `real_token_reserves = CURVE_SUPPLY` (X-4 seed); virtual reserves, graduation
 * threshold, and the per-token `trade_fee_bps` (§12.40d) all read PER-CURVE from
 * the freshly-deployed `BondingCurve`'s public immutables via viem +
 * `bondingCurveAbi` (spec §12.38; see src/curveReader.ts for why per-curve and
 * not `config()`). `createToken` is low-frequency, so the bounded read set here
 * is not a hot path. `v3_pool_address` from the event `pool` (the pool is
 * pre-created at creation, §12.15 — but V3 Swap indexing still begins only at
 * Graduated). Idempotent: a token is created once, dedup by address (the read is
 * skipped entirely on re-delivery of an already-seeded token).
 *
 * NOTE: the `metadata_verifications` `unfetched` seed (offchain table) and the
 * `global:launches` Redis publish are wired by M2-7 / M2-8 respectively — out of
 * this task's scope; the seam is the row written here.
 */
import { ponder } from "ponder:registry";
import { tokens } from "ponder:schema";
import { TOTAL_SUPPLY_WEI } from "@robbed/shared";
import { curveRegistry } from "../curveRegistry";
import { readCurveImmutables } from "../curveReader";
import { lower } from "../ids";
import { publishLaunch } from "../publish";

ponder.on("CurveFactory:TokenCreated", async ({ event, context }) => {
  const tokenAddress = lower(event.args.token);
  const curveAddress = lower(event.args.curve);

  // Keep the curve → token routing table warm for the Trade handler.
  curveRegistry.register(curveAddress, tokenAddress);

  // Dedup: a token is created exactly once (reorg re-delivery is a no-op). Guard
  // BEFORE the RPC reads so re-delivery costs nothing.
  const existing = await context.db.find(tokens, { address: tokenAddress });
  if (existing) return;

  // Per-curve on-chain read of the deploy immutables (§12.40d) — supersedes the
  // M2-4 env interim. Virtual reserves, curve supply (X-4 seed), graduation
  // threshold, and the per-token trade fee all come from THIS curve.
  const curve = await readCurveImmutables(context.client, curveAddress);

  await context.db.insert(tokens).values({
    address: tokenAddress,
    curveAddress,
    creator: lower(event.args.creator),
    creatorFeeBps: 0, // §7: 0 in v1
    tradeFeeBps: curve.tradeFeeBps, // §12.40d: per-token snapshot, Trust-panel source
    name: event.args.name,
    ticker: event.args.symbol,
    metadataHash: event.args.metadataHash.toLowerCase(),
    metadataUri: event.args.metadataUri,
    imageUrl: null,
    description: null,
    links: null,
    totalSupply: TOTAL_SUPPLY_WEI,
    virtualEth: curve.virtualEth0,
    virtualToken: curve.virtualToken0,
    realEthReserves: 0n,
    realTokenReserves: curve.curveSupply, // X-4 seed
    graduationEth: curve.graduationEth,
    graduated: false,
    v3PoolAddress: lower(event.args.pool),
    graduatedAt: null,
    lastPriceEth: null,
    volumeEth24h: 0n,
    tradeCount: 0n,
    holderCount: 0,
    createdAt: event.block.timestamp,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    confirmationState: "soft_confirmed",
  });

  // Redis publish → Discover launches ticker (§5.1). imageUrl is null until the
  // metadata verifier (M2-7) fetches it; the launch card renders without it.
  publishLaunch({
    address: tokenAddress,
    name: event.args.name,
    ticker: event.args.symbol,
    creator: lower(event.args.creator),
    createdAt: Number(event.block.timestamp),
    blockNumber: Number(event.block.number),
    confirmationState: "soft_confirmed",
  });
});
