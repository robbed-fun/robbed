/**
 * Indexer configuration & address resolution (indexer.md).
 *
 * ── chain-identity gate (ratified 2026-07-12, self-contained record) ──
 * `INDEXER_CHAIN_ID` is REQUIRED and has NO default: the env var SELECTS a
 * chain, it never defines chain facts — the value must resolve in the shared
 * deployment registry (`@robbed/shared/addresses`, codegen from
 * `contracts/deployments/<chainId>.json`, D-2), and the live RPC's
 * `eth_chainId` is asserted equal at boot (`assertRuntime`, the (b) live half).
 * Every chain-dependent address (WETH, V3 factory/NPM/SwapRouter02, the robbed
 * contracts, treasury) resolves from that registry entry per —
 * per-chain address defaults inside indexer code are FORBIDDEN. The live
 * deploy artifact (compose-injected local.env/testnet.env) takes precedence
 * over the registry snapshot for the robbed contracts (see loadConfig note).
 * Addresses are stored and compared lowercase throughout (indexer.md).
 *
 * NO market metrics live here (hard rule).
 *
 * Curve deploy constants (`CURVE_SUPPLY`, `VIRTUAL_ETH_0`/`VIRTUAL_TOKEN_0`,
 * `GRADUATION_ETH`, `TRADE_FEE_BPS`) are NO LONGER config: they are read
 * **per-curve** from each `BondingCurve`'s public immutables at `TokenCreated`
 * via viem + the shared `bondingCurveAbi` (— see
 * `src/curveReader.ts`). The prior env interim (`CURVE_SUPPLY_WEI` &c., a
 * documented M2-4 stopgap while the read-ABI was unlanded) is dropped. This is
 * the ratified per-token model: the factory `config()` snapshot exposes
 * only the factory-*current* curve-shape defaults (`FactoryConfig`, #39)
 * and would misreport any curve created under a prior fee — so we read each
 * curve, never `config()` (the divergence M1-3b flagged: these five are
 * `internal immutable` on CurveFactory, not surfaced by `config()`).
 */
import { ROBBED_DEPLOYMENTS, getDeployment } from "@robbed/shared/addresses";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function req(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    throw new Error(`[indexer config] missing required env ${name}`);
  }
  return v;
}

/**
 * Deploy-artifact env injection with registry fallback (note in
 * loadConfig): env set ⇒ validated env value wins (live artifact); unset ⇒ the
 * shared-registry value. The fallback is ALWAYS registry-sourced — never a
 * literal in this file.
 */
function envAddressOr(name: string, registryValue: string): string {
  const raw = process.env[name];
  const v = (raw && raw !== "" ? raw : registryValue).toLowerCase();
  if (!ADDRESS_RE.test(v)) throw new Error(`[indexer config] ${name} is not a 20-byte address: ${v}`);
  if (v === ZERO_ADDRESS) throw new Error(`[indexer config] ${name} must be non-zero`);
  return v;
}

/**
 * OPTIONAL deploy address: env override wins, else the (possibly absent)
 * registry value, else `undefined`. Validates format only when a value is
 * present. Used for ADDITIVE/optional contracts — the `creatorVault` is
 * absent on every v1 deployment (no vault exists until a creator-fee factory is
 * deployed), so the caller registers its Ponder source ONLY when this resolves,
 * mirroring the chain-identity gate's fail-graceful treatment of optional
 * config (never crash a treasury-only deployment).
 */
function optAddressOr(name: string, registryValue: string | undefined): string | undefined {
  const raw = process.env[name];
  const chosen = raw && raw !== "" ? raw : registryValue;
  if (!chosen) return undefined;
  const v = chosen.toLowerCase();
  if (!ADDRESS_RE.test(v)) throw new Error(`[indexer config] ${name} is not a 20-byte address: ${v}`);
  if (v === ZERO_ADDRESS) throw new Error(`[indexer config] ${name} must be non-zero`);
  return v;
}

/** Required integer env (no default). */
function reqInt(name: string): number {
  const v = req(name);
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`[indexer config] ${name} must be a positive integer, got ${JSON.stringify(v)}`);
  return n;
}

function optInt(name: string, dflt: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`[indexer config] ${name} must be a non-negative integer`);
  return n;
}

export interface IndexerConfig {
  chainId: number;
  rpcHttp: string;
  rpcWs: string | undefined;
  startBlock: number;
  weth: string;
  curveFactory: string;
  router: string | undefined;
  migrator: string;
  /**
   * Phase-2 pull-payment CreatorVault. OPTIONAL: absent on
   * every v1 deployment (no vault until a creator-fee factory is deployed). When
   * present, `ponder.config.ts` registers a NEW `CreatorVault` source for
   * `CreatorFeeDeposited` / `CreatorFeeClaimed`; when absent, that source is not
   * registered and the vault handlers do not bind — a treasury-only deployment
   * indexes normally (graceful skip). Registry-resolved, env-overridable; lowercased.
   */
  creatorVault: string | undefined;
  /**
   * The creator-aware LPFeeVault — the single source for the
   * post-graduation 50/50 `FeesSplit` event. Always present in the deployment
   * registry (`robbed.lpFeeVault`), but the `FeesSplit` handler + Ponder source
   * are registered ONLY on the creator-fee generation (gated on `creatorVault`,
   * which co-exists with the split LPFeeVault): a v1 LPFeeVault never emits
   * `FeesSplit`, so registering its source there would only start a no-op sync.
   * Registry-resolved, env-overridable; lowercased.
   */
  lpFeeVault: string;
  v3Factory: string;
  v3PositionManager: string;
  /** Chain's SwapRouter02 (registry-resolved) — own-contract whitelist (heuristic 3). */
  swapRouter02: string;
  redisUrl: string | undefined;
  databaseUrl: string | undefined;
  databaseSchema: string | undefined;
  r2MetadataBaseUrl: string | undefined;
  /**
   * Dev-only metadata fetch-URL prefix rewrite (METADATA_FETCH_REWRITE_FROM/_TO,
   * both set or neither — fail-closed on a half pair): the on-chain
   * `metadataUri` is the BROWSER-visible object URL (host-mapped minio port in
   * dev), unreachable from inside the indexer container, so the verifier
   * rewrites that prefix to the container-internal service-DNS base
   * (`http://minio:9000/...`). Unset in production (the CDN base is reachable
   * from everywhere). Fetch-time only — never changes stored/published URLs.
   */
  metadataFetchRewrite: { from: string; to: string } | undefined;
  /** Treasury (Gnosis Safe) — the ONLY valid V3 `Collect` recipient;
   * a `Collect` to any other address pages gate-7. Config-sourced, never
   *  hardcoded; lowercased. Optional so the alert degrades to a warn if unset. */
  treasury: string | undefined;
}

/**
 * Build the config from the environment. Throws (fail-closed) on any missing /
 * invalid required var — this is how the startup assertions (indexer.md)
 * surface at Ponder config-load time. Called once by `ponder.config.ts` and by
 * the migrate/rebuild scripts.
 */
export function loadConfig(): IndexerConfig {
  // ── +(b) static half: explicit selection, registry-validated, NO default ──
  const chainId = reqInt("INDEXER_CHAIN_ID");
  const deployment = getDeployment(chainId);
  if (!deployment) {
    throw new Error(
      `[indexer config] INDEXER_CHAIN_ID=${chainId} has no entry in the shared deployment registry ` +
        `(packages/shared/src/addresses.ts — recorded chains: ${Object.keys(ROBBED_DEPLOYMENTS).join(", ")}). ` +
        `: the env var SELECTS a chain, it never defines one; nothing can be invented via env.`,
    );
  }
  // ── known limit: the "4663" registry entry is a mainnet-FORK pipeline artifact ──
  // (anvil dev-account treasury; contracts/deployments/4663.json is fork-evidence-only under
  // D-2). Until a real Phase-B deploy replaces it, 4663 is FORBIDDEN outside a LOCAL fork
  // stack; the fork stack declares itself via INDEXER_ALLOW_FORK_4663=1 (docker-compose.yml).
  // Follow-up for a mode-based assertion is routed to robbed-contracts in the ruling text.
  if (chainId === 4663 && process.env.INDEXER_ALLOW_FORK_4663 !== "1") {
    throw new Error(
      `[indexer config] INDEXER_CHAIN_ID=4663 refused (known limit) the registry's 4663 entry ` +
        `is a mainnet-fork pipeline artifact — 4663 is forbidden outside a LOCAL fork stack until a real ` +
        `Phase-B deploy replaces it. A LOCAL fork stack sets INDEXER_ALLOW_FORK_4663=1 (compose-injected).`,
    );
  }
  return {
    chainId,
    rpcHttp: req("INDEXER_RPC_HTTP"),
    rpcWs: process.env.INDEXER_RPC_WS || undefined,
    startBlock: optInt("START_BLOCK", 0),
    // ── : chain-dependent addresses resolve from the registry entry ──
    // External set: registry ONLY (the per-chain in-code defaults this replaces
    // were the motivating defect — mainnet V3 silently used on testnet).
    weth: deployment.external.weth.toLowerCase(),
    v3Factory: deployment.external.v3Factory.toLowerCase(),
    v3PositionManager: deployment.external.positionManager.toLowerCase(),
    swapRouter02: deployment.external.swapRouter02.toLowerCase(),
    // Robbed contracts + treasury: same registry resolution, but the LIVE deploy
    // artifact (compose-injected local.env/testnet.env, D-2) takes
    // precedence when present — on a LOCAL fork stack every `up` runs a fresh
    // deploy, so the artifact is the live truth and the codegen registry entry is
    // its (possibly stale) snapshot; on testnet/mainnet the two are identical by
    // construction. Artifact injection is not a per-chain default in code.
    curveFactory: envAddressOr("CURVE_FACTORY_ADDRESS", deployment.robbed.curveFactory),
    router: envAddressOr("ROUTER_ADDRESS", deployment.robbed.router),
    migrator: envAddressOr("MIGRATOR_ADDRESS", deployment.robbed.v3Migrator),
    // optional — undefined on v1 (no vault in the registry entry). Never
    // crashes when absent; the CreatorVault Ponder source is registered only when set.
    creatorVault: optAddressOr("CREATOR_VAULT_ADDRESS", deployment.robbed.creatorVault),
    // — always in the registry; only USED to register the FeesSplit source
    // when creatorVault also resolves (the creator-fee generation). Never a code default.
    lpFeeVault: envAddressOr("LP_FEE_VAULT_ADDRESS", deployment.robbed.lpFeeVault),
    redisUrl: process.env.REDIS_URL || undefined,
    databaseUrl: process.env.DATABASE_URL || undefined,
    databaseSchema: process.env.DATABASE_SCHEMA || undefined,
    r2MetadataBaseUrl: process.env.R2_METADATA_BASE_URL || undefined,
    metadataFetchRewrite: loadFetchRewrite(),
    treasury: envAddressOr("TREASURY_ADDRESS", deployment.robbed.treasury),
  };
}

/** Both-or-neither pair; a half-configured rewrite is a config bug → throw. */
function loadFetchRewrite(): { from: string; to: string } | undefined {
  const from = process.env.METADATA_FETCH_REWRITE_FROM || undefined;
  const to = process.env.METADATA_FETCH_REWRITE_TO || undefined;
  if (!from && !to) return undefined;
  if (!from || !to) {
    throw new Error(
      "[indexer config] METADATA_FETCH_REWRITE_FROM and METADATA_FETCH_REWRITE_TO must be set together",
    );
  }
  return { from, to };
}

export { ZERO_ADDRESS };
