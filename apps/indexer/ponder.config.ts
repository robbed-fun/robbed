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
 * Creator-fee leg (§12.63, ADDITIVE): `CreatorFeesSwept` folds into the EXISTING
 * BondingCurve source (ABI merge below), and — ONLY when the optional
 * `config.creatorVault` resolves (absent on v1 deployments) — a NEW `CreatorVault`
 * single source is registered for `CreatorFeeDeposited` / `CreatorFeeClaimed`. On
 * a treasury-only deployment the vault source is simply omitted, so the indexer
 * runs unchanged (graceful skip — mirrors the §12.55 optional-config gate).
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
  bondingCurveCreatorEventsAbi,
  bondingCurveEventsAbi,
  creatorVaultEventsAbi,
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

// CreatorVault (§12.63) — single source at the deployment vault; registered ONLY
// when the optional address resolves. Spread into `contracts` so an absent vault
// leaves the source (and its handlers, guarded identically) unregistered.
const creatorVaultContract = config.creatorVault
  ? {
      CreatorVault: {
        abi: creatorVaultEventsAbi,
        chain: "robinhood" as const,
        address: config.creatorVault as `0x${string}`,
        startBlock: config.startBlock,
      },
    }
  : {};

export default createConfig({
  chains: {
    robinhood: {
      id: config.chainId, // INDEXER_CHAIN_ID: registry-validated + live-RPC-asserted (§12.55(b))
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
    // Trade (+ CreatorFeesSwept §12.63) — one BondingCurve per token, discovered
    // via TokenCreated.curve. ABI merges the ratified Trade slice with the additive
    // creator-leg event (the shared groupings stay separate; merged only here).
    BondingCurve: {
      abi: [...bondingCurveEventsAbi, ...bondingCurveCreatorEventsAbi],
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
    // CreatorVault (§12.63) — present only on creator-fee deployments (see above).
    ...creatorVaultContract,
  },
});
