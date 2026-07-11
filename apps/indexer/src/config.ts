/**
 * Indexer configuration & address resolution (indexer.md §2).
 *
 * All addresses come from env EXCEPT canonical WETH (asserted, never
 * configurable) and the ratified Uniswap V3 registry (spec §12.28, mirrored in
 * `@robbed/shared` `UNISWAP_V3`) which env may override. Addresses are stored
 * and compared lowercase throughout (indexer.md §3 conventions).
 *
 * NO market metrics live here (spec §2 hard rule).
 *
 * Curve deploy constants (`CURVE_SUPPLY`, `VIRTUAL_ETH_0`/`VIRTUAL_TOKEN_0`,
 * `GRADUATION_ETH`, `TRADE_FEE_BPS`) are NO LONGER config: they are read
 * **per-curve** from each `BondingCurve`'s public immutables at `TokenCreated`
 * via viem + the shared `bondingCurveAbi` (§12.38/§12.40d — see
 * `src/curveReader.ts`). The prior env interim (`CURVE_SUPPLY_WEI` &c., a
 * documented M2-4 stopgap while the read-ABI was unlanded) is dropped. This is
 * the ratified §12.40d per-token model: the factory `config()` snapshot exposes
 * only the factory-*current* curve-shape defaults (`FactoryConfig`, §12.40 #39)
 * and would misreport any curve created under a prior fee — so we read each
 * curve, never `config()` (the divergence M1-3b flagged: these five are
 * `internal immutable` on CurveFactory, not surfaced by `config()`).
 */
import { UNISWAP_V3, WETH_ADDRESS, CHAIN_ID } from "@robbed/shared";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function req(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    throw new Error(`[indexer config] missing required env ${name}`);
  }
  return v;
}

/** Normalize + validate an address env var (lowercased, non-zero). */
function reqAddress(name: string): string {
  const v = req(name).toLowerCase();
  if (!ADDRESS_RE.test(v)) throw new Error(`[indexer config] ${name} is not a 20-byte address: ${v}`);
  if (v === ZERO_ADDRESS) throw new Error(`[indexer config] ${name} must be non-zero`);
  return v;
}

/** Address env with a ratified default (env override allowed), lowercased + non-zero. */
function addressWithDefault(name: string, fallback: string): string {
  const raw = process.env[name];
  const v = (raw && raw !== "" ? raw : fallback).toLowerCase();
  if (!ADDRESS_RE.test(v)) throw new Error(`[indexer config] ${name} is not a 20-byte address: ${v}`);
  if (v === ZERO_ADDRESS) throw new Error(`[indexer config] ${name} must be non-zero`);
  return v;
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
  v3Factory: string;
  v3PositionManager: string;
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
  /** Treasury (Gnosis Safe) — the ONLY valid V3 `Collect` recipient (§6.4/§6.6);
   *  a `Collect` to any other address pages gate-7 (§9.4). Config-sourced, never
   *  hardcoded; lowercased. Optional so the alert degrades to a warn if unset. */
  treasury: string | undefined;
}

/**
 * Build the config from the environment. Throws (fail-closed) on any missing /
 * invalid required var — this is how the startup assertions (indexer.md §2)
 * surface at Ponder config-load time. Called once by `ponder.config.ts` and by
 * the migrate/rebuild scripts.
 */
export function loadConfig(): IndexerConfig {
  return {
    chainId: CHAIN_ID,
    rpcHttp: req("INDEXER_RPC_HTTP"),
    rpcWs: process.env.INDEXER_RPC_WS || undefined,
    startBlock: optInt("START_BLOCK", 0),
    // WETH is asserted against the canonical constant, never taken from env.
    weth: WETH_ADDRESS.toLowerCase(),
    curveFactory: reqAddress("CURVE_FACTORY_ADDRESS"),
    router: process.env.ROUTER_ADDRESS ? process.env.ROUTER_ADDRESS.toLowerCase() : undefined,
    migrator: reqAddress("MIGRATOR_ADDRESS"),
    // V3 factory / NPM: ratified registry (spec §12.28) as default, env may override.
    v3Factory: addressWithDefault("V3_FACTORY_ADDRESS", UNISWAP_V3.factory),
    v3PositionManager: addressWithDefault("V3_NPM_ADDRESS", UNISWAP_V3.positionManager),
    redisUrl: process.env.REDIS_URL || undefined,
    databaseUrl: process.env.DATABASE_URL || undefined,
    databaseSchema: process.env.DATABASE_SCHEMA || undefined,
    r2MetadataBaseUrl: process.env.R2_METADATA_BASE_URL || undefined,
    metadataFetchRewrite: loadFetchRewrite(),
    treasury: process.env.TREASURY_ADDRESS ? process.env.TREASURY_ADDRESS.toLowerCase() : undefined,
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

export { WETH_ADDRESS, ZERO_ADDRESS };
