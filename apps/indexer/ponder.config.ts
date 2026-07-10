/**
 * Ponder config (indexer.md §2, §7.4) — the six event families over the FROZEN
 * ABIs in `@robbed/shared` (`abi/events.ts`). Nothing is re-declared locally.
 *
 * Sources (indexer.md §7.4):
 * - CurveFactory        single source          → TokenCreated (§3.1)
 * - BondingCurve        factory(TokenCreated.curve)  → Trade (§3.2)
 * - LaunchToken         factory(TokenCreated.token)  → Transfer (§3.6, §12.16)
 * - V3Migrator          single source          → Graduated (§3.3)
 * - UniswapV3Pool       factory(Graduated.pool) → Swap (graduated pools only, §3.4)
 * - V3PositionManager   single source          → Collect (§3.5; handler filters
 *                                                 to known lp_token_ids)
 *
 * `factory({ address, event, parameter })` is the ponder.sh-confirmed mechanism
 * for child contracts; `event.log.address` in the handler identifies the
 * emitting child (used for the curve→token and pool→token joins).
 *
 * Static startup assertions (WETH, chain 4663, non-zero V3 addrs) run HERE at
 * config load — if they throw, Ponder never starts (fail-closed, indexer.md
 * §2/§11). Curve constants are no longer a startup concern: they are read
 * per-curve from each BondingCurve's immutables at TokenCreated (§12.40d). The
 * runtime assertions (pg_trgm, RPC chain id) run in `scripts/migrate.ts` before
 * `ponder start`.
 */
import { createConfig, factory } from "ponder";
import {
  bondingCurveEventsAbi,
  curveFactoryEventsAbi,
  graduatedEvent,
  launchTokenEventsAbi,
  tokenCreatedEvent,
  v3MigratorEventsAbi,
  v3PoolEventsAbi,
  v3PositionManagerEventsAbi,
} from "@robbed/shared/abi";
import { loadConfig } from "./src/config";
import { assertStaticConfig } from "./src/assertions";

const config = loadConfig();
assertStaticConfig(config);

export default createConfig({
  chains: {
    robinhood: {
      id: config.chainId, // asserted === 4663
      // Alchemy WS for realtime (<500ms budget, §8); HTTP for historical backfill.
      rpc: config.rpcHttp,
      ...(config.rpcWs ? { ws: config.rpcWs } : {}),
    },
  },
  contracts: {
    // TokenCreated — root factory event; also the factory anchor for curves+tokens.
    CurveFactory: {
      abi: curveFactoryEventsAbi,
      chain: "robinhood",
      address: config.curveFactory as `0x${string}`,
      startBlock: config.startBlock,
    },
    // Trade — one BondingCurve per token, discovered via TokenCreated.curve.
    BondingCurve: {
      abi: bondingCurveEventsAbi,
      chain: "robinhood",
      address: factory({
        address: config.curveFactory as `0x${string}`,
        event: tokenCreatedEvent,
        parameter: "curve",
      }),
      startBlock: config.startBlock,
    },
    // Transfer — one LaunchToken per token, discovered via TokenCreated.token.
    LaunchToken: {
      abi: launchTokenEventsAbi,
      chain: "robinhood",
      address: factory({
        address: config.curveFactory as `0x${string}`,
        event: tokenCreatedEvent,
        parameter: "token",
      }),
      startBlock: config.startBlock,
    },
    // Graduated — emitted by the V3Migrator (single-fire per token).
    V3Migrator: {
      abi: v3MigratorEventsAbi,
      chain: "robinhood",
      address: config.migrator as `0x${string}`,
      startBlock: config.startBlock,
    },
    // V3 Swap — only pools that have graduated, discovered via Graduated.pool.
    UniswapV3Pool: {
      abi: v3PoolEventsAbi,
      chain: "robinhood",
      address: factory({
        address: config.migrator as `0x${string}`,
        event: graduatedEvent,
        parameter: "pool",
      }),
      startBlock: config.startBlock,
    },
    // V3 Collect — single source on the NPM; handler filters to LPFeeVault positions.
    V3PositionManager: {
      abi: v3PositionManagerEventsAbi,
      chain: "robinhood",
      address: config.v3PositionManager as `0x${string}`,
      startBlock: config.startBlock,
    },
  },
});
