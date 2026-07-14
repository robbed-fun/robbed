/**
 * ETH/USD snapshot poller (indexer.md; hard rule).
 *
 * Writes SOURCE + TIMESTAMPED rows into `eth_usd_snapshots` on a config cadence
 * (30–60s per; default 30s). Every USD figure anywhere in the product is
 * `eth_value × latest snapshot` — this poller is the ONLY producer, the API's
 * `/v1/eth-usd` the single reader (OI-A10). It NEVER fabricates a price :
 * on all-source failure it records nothing, and staleness surfaces through the
 * existing gate-7 `eth_usd_snapshot_age_seconds` gauge (metricsStore derives it
 * from `MAX(fetched_at)` — writing rows here is the wiring; alert > 5m).
 *
 * Source chain (recorded 2026-07-11 — closes OI-6):
 *   1. Chainlink ETH/USD proxy on 4663 MAINNET ONLY — proxy
 *      {@link CHAINLINK_ETH_USD_PROXY_4663} (aggregator
 *      0x6091E64eb7138EEF066a80FD3A0d7427B91f2721), source label `chainlink:4663`.
 *      MANDATORY fail-closed startup assertions: `description() == "ETH / USD"`
 * and `decimals() == 8` (mirrors the V3 deploy-time assertions).
 *      An assertion failure DISABLES the poller entirely (no silent HTTP
 *      masking of a misconfigured feed address — the age alert pages instead).
 * 2. HTTP fallback (`ETH_USD_SOURCE_URL`, env-inventory.md) DefiLlama /
 *      Coinbase. Used when (a) the chain is not 4663 (LOCAL fresh chains /
 * TESTNET 46630 skip the Chainlink branch entirely), (b) the
 *      Chainlink branch is disabled via `CHAINLINK_ETH_USD_FEED=off`, or (c) a
 *      Chainlink answer fails the runtime staleness check.
 *
 * Decide-it-yourself decisions (recorded per the research→decide→verify loop):
 * - **Mainnet gate = RPC `eth_chainId` at poller start** (viem `getChainId`,
 *   verified against viem.sh docs). Chain id 4663 is a compile-time constant
 *   (env-inventory conventions), so the runtime RPC answer is the only honest
 *   environment signal: testnet (46630) and fresh local chains skip Chainlink
 *   automatically; a local anvil FORK of 4663 reports 4663 and the feed exists
 *   in fork state, so assertions pass and the branch genuinely works. A fresh
 *   local chain deliberately launched with id 4663 must set
 * `CHAINLINK_ETH_USD_FEED=off` (documented in env-inventory.md).
 * - **Feed address discipline**: single hex location — the shared
 *   {@link CHAINLINK_ETH_USD_PROXY_4663} const (`@robbed/shared` constants,
 *   next to `UNISWAP_V3`; adopted by robbed-shared 2026-07-11) with env
 *   override `CHAINLINK_ETH_USD_FEED` — mirrors the config.ts
 * `addressWithDefault` pattern used for the V3 registry.
 * - **Staleness window default 3600s** (`ETH_USD_CHAINLINK_STALENESS_SECONDS`):
 *   Chainlink's standard ETH/USD heartbeat is 1h; docs recommend a threshold
 *   ≥ heartbeat. A too-tight window merely shifts to the (fresh, correctly
 *   labeled) HTTP fallback — it can never mislabel or fabricate — so the
 *   conservative default is safe on both sides. Env-tunable if the 4663 feed's
 *   RDD heartbeat proves longer.
 * - **`fetched_at` = poll instant** (not the round's `updatedAt`): the table PK
 *   and the age gauge measure snapshot recency; round freshness is enforced
 *   separately by the staleness check. Idempotent write via
 *   `ON CONFLICT (fetched_at) DO NOTHING`.
 * - **AggregatorV3Interface ABI + feed address are SHARED**: imported from
 *   `@robbed/shared` (`abi/external.ts` `aggregatorV3Abi`, constants
 *   `CHAINLINK_ETH_USD_PROXY_4663`) — adopted by robbed-shared 2026-07-11 per
 *   the anti-drift rule; never redeclare either here.
 *
 * PURE + injectable (same shape as jobs/competitor.ts): the sidecar passes a
 * viem public client + pg store; tests pass stubs. Failures are advisory —
 * indexing is never affected (spirit: this labels, it never gates).
 */
import { Pool } from "pg";
import { createPublicClient, http } from "viem";
import type { EthUsdSnapshotRow } from "@robbed/shared";
import { CHAINLINK_ETH_USD_PROXY_4663 } from "@robbed/shared";
import { aggregatorV3Abi } from "@robbed/shared/abi";

/** Source label for feed-sourced rows (indexer.md / shared api-types). */
export const CHAINLINK_SOURCE_LABEL = "chainlink:4663";

export type AggregatorFn = "decimals" | "description" | "latestRoundData";

/** Structural viem-style reader (same pattern as curveReader.ContractReader)
 *  so the poller stays a pure, unit-testable unit. */
export interface AggregatorReader {
  readContract(args: {
    abi: typeof aggregatorV3Abi;
    address: `0x${string}`;
    functionName: AggregatorFn;
  }): Promise<unknown>;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const CHAINLINK_DECIMALS = 8; // asserted, never assumed

/** cadence default: 30s (spec band 30–60s). */
export const ETH_USD_POLL_INTERVAL_MS = 30_000;
/** Chainlink answer staleness window default: 1h heartbeat (see header). */
export const ETH_USD_CHAINLINK_STALENESS_SECONDS = 3_600;

export interface EthUsdEnvConfig {
  /** Feed proxy address or `"off"` — LOCAL/TESTNET disable. Env overrides are
   * lowercased; the default keeps the casing of the shared const. */
  chainlinkFeed: `0x${string}` | "off";
  /** HTTP fallback URL (DefiLlama/Coinbase) — undefined ⇒ no HTTP source. */
  sourceUrl: string | undefined;
  pollIntervalMs: number;
  stalenessSeconds: number;
}

/** Read poller env (fail-closed on malformed values, like config.ts). */
export function loadEthUsdEnv(env: Record<string, string | undefined> = process.env): EthUsdEnvConfig {
  const rawFeed = env.CHAINLINK_ETH_USD_FEED;
  let chainlinkFeed: `0x${string}` | "off";
  if (rawFeed === "off") {
    chainlinkFeed = "off";
  } else if (rawFeed === undefined || rawFeed === "") {
    chainlinkFeed = CHAINLINK_ETH_USD_PROXY_4663; // recorded default for 4663
  } else {
    if (!ADDRESS_RE.test(rawFeed)) {
      throw new Error(`[eth-usd] CHAINLINK_ETH_USD_FEED must be a 20-byte address or 'off', got: ${rawFeed}`);
    }
    chainlinkFeed = rawFeed.toLowerCase() as `0x${string}`;
  }
  const pollIntervalMs = Number(env.ETH_USD_POLL_INTERVAL_MS) || ETH_USD_POLL_INTERVAL_MS;
  const stalenessSeconds = Number(env.ETH_USD_CHAINLINK_STALENESS_SECONDS) || ETH_USD_CHAINLINK_STALENESS_SECONDS;
  return {
    chainlinkFeed,
    sourceUrl: env.ETH_USD_SOURCE_URL || undefined,
    pollIntervalMs,
    stalenessSeconds,
  };
}

/**
 * MANDATORY startup assertions, fail-closed: `description()` must be
 * exactly "ETH / USD" and `decimals()` exactly 8. Throws on any mismatch or
 * read failure (e.g. no contract at the address) — the caller must NOT start
 * the Chainlink branch (and must not mask the misconfiguration with HTTP).
 */
export async function assertChainlinkFeed(client: AggregatorReader, feed: `0x${string}`): Promise<void> {
  let description: unknown;
  let decimals: unknown;
  try {
    [description, decimals] = await Promise.all([
      client.readContract({ abi: aggregatorV3Abi, address: feed, functionName: "description" }),
      client.readContract({ abi: aggregatorV3Abi, address: feed, functionName: "decimals" }),
    ]);
  } catch (err) {
    throw new Error(`[eth-usd] FAIL-CLOSED () cannot read Chainlink feed ${feed}: ${String(err)}`);
  }
  if (description !== "ETH / USD") {
    throw new Error(
      `[eth-usd] FAIL-CLOSED : feed ${feed} description() is ${JSON.stringify(description)}, expected "ETH / USD"`,
    );
  }
  if (Number(decimals) !== CHAINLINK_DECIMALS) {
    throw new Error(`[eth-usd] FAIL-CLOSED () feed ${feed} decimals() is ${String(decimals)}, expected 8`);
  }
}

export interface PriceObservation {
  priceUsd: number;
  source: string;
}

/**
 * Read `latestRoundData()` and apply the staleness check. Returns null
 * (rejecting the answer, logged by the caller) when the round's `updatedAt`
 * exceeds the staleness window, the answer is non-positive, or the round is
 * incomplete (`updatedAt == 0`). Never coerces a bad answer into a price.
 */
export async function readChainlinkPrice(
  client: AggregatorReader,
  feed: `0x${string}`,
  nowMs: number,
  stalenessSeconds: number,
): Promise<PriceObservation | null> {
  const round = (await client.readContract({
    abi: aggregatorV3Abi,
    address: feed,
    functionName: "latestRoundData",
  })) as readonly [bigint, bigint, bigint, bigint, bigint];
  const [, answer, , updatedAt] = round;
  if (updatedAt === 0n) return null; // incomplete round
  if (answer <= 0n) return null; // nonsense answer — never a fabricated price
  const ageSeconds = Math.floor(nowMs / 1000) - Number(updatedAt);
  if (ageSeconds > stalenessSeconds) return null; // stale — caller falls back
  // decimals() == 8 is asserted at startup; float precision is ample
  // for a USD display price (numeric column, shared row type uses number).
  return { priceUsd: Number(answer) / 10 ** CHAINLINK_DECIMALS, source: CHAINLINK_SOURCE_LABEL };
}

/** Source label for an HTTP fallback URL — `defillama`/`coinbase` (the
 *  documented chain) by host, else `http:<host>`; never an unlabeled row. */
export function httpSourceLabel(url: string): string {
  const host = new URL(url).hostname;
  if (host.endsWith("llama.fi")) return "defillama";
  if (host.endsWith("coinbase.com")) return "coinbase";
  return `http:${host}`;
}

/**
 * Parse the two documented fallback response shapes (env-inventory.md):
 * DefiLlama `coins.llama.fi/prices/current/coingecko:ethereum` →
 * `{coins:{"coingecko:ethereum":{price}}}`; Coinbase `v2/prices/ETH-USD/spot`
 * → `{data:{amount:"1815.64"}}`; plus a plain `{price}` for local stubs.
 * Returns null on anything unrecognized/non-finite (never coerces).
 */
export function parseHttpPrice(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const obj = body as Record<string, unknown>;
  // DefiLlama
  const coins = obj.coins;
  if (typeof coins === "object" && coins !== null) {
    for (const entry of Object.values(coins as Record<string, unknown>)) {
      if (typeof entry === "object" && entry !== null) {
        const p = (entry as Record<string, unknown>).price;
        if (typeof p === "number" && Number.isFinite(p) && p > 0) return p;
      }
    }
    return null;
  }
  // Coinbase
  const data = obj.data;
  if (typeof data === "object" && data !== null) {
    const amount = (data as Record<string, unknown>).amount;
    const n = typeof amount === "string" ? Number(amount) : typeof amount === "number" ? amount : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  // Plain {price} stub
  const p = obj.price;
  if (typeof p === "number" && Number.isFinite(p) && p > 0) return p;
  return null;
}

/** Fetch the HTTP fallback price. Returns null on any failure (records nothing). */
export async function fetchHttpPrice(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PriceObservation | null> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const price = parseHttpPrice(await res.json());
  if (price === null) return null;
  return { priceUsd: price, source: httpSourceLabel(url) };
}

export interface EthUsdStore {
  write(row: EthUsdSnapshotRow): Promise<void>;
}

export function createPgEthUsdStore(pool: Pool): EthUsdStore {
  return {
    async write(row: EthUsdSnapshotRow): Promise<void> {
      // fetched_at is the PK — re-delivery of the same instant is a no-op.
      await pool.query(
        `INSERT INTO eth_usd_snapshots (fetched_at, price_usd, source)
         VALUES ($1::timestamptz, $2, $3)
         ON CONFLICT (fetched_at) DO NOTHING`,
        [row.fetched_at, row.price_usd, row.source],
      );
    },
  };
}

export interface EthUsdTickDeps {
  store: EthUsdStore;
  /** Chainlink branch — undefined when skipped (non-4663 chain / `off`). */
  chainlink: { client: AggregatorReader; feed: `0x${string}` } | undefined;
  /** HTTP fallback — undefined when `ETH_USD_SOURCE_URL` unset. */
  httpUrl: string | undefined;
  stalenessSeconds: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

/**
 * One poll iteration: Chainlink (if enabled) → staleness check → else HTTP
 * fallback → else NOTHING (never a fabricated price, — the age gauge is the
 * staleness surface). Returns the written row or null.
 */
export async function runEthUsdTick(deps: EthUsdTickDeps): Promise<EthUsdSnapshotRow | null> {
  const now = deps.now ?? (() => new Date());
  const log = deps.logger ?? console;
  const at = now();

  let observation: PriceObservation | null = null;

  if (deps.chainlink) {
    try {
      observation = await readChainlinkPrice(
        deps.chainlink.client,
        deps.chainlink.feed,
        at.getTime(),
        deps.stalenessSeconds,
      );
      if (observation === null) {
        log.warn(`[eth-usd] chainlink answer rejected (stale/incomplete/non-positive) — trying HTTP fallback ().`);
      }
    } catch (err) {
      observation = null;
      log.warn(`[eth-usd] chainlink read failed — trying HTTP fallback ():`, err);
    }
  }

  if (observation === null && deps.httpUrl) {
    try {
      observation = await fetchHttpPrice(deps.httpUrl, deps.fetchImpl ?? fetch);
    } catch (err) {
      observation = null;
      log.warn(`[eth-usd] HTTP fallback failed:`, err);
    }
  }

  if (observation === null) {
    // All sources failed: record NOTHING. eth_usd_snapshot_age_seconds
    // (gate-7 registry, metricsStore MAX(fetched_at)) surfaces the gap; alert
    // fires > 5m and USD displays go "dated", never stale-silent.
    log.error(`[eth-usd] no price source available — no snapshot written (never fabricated).`);
    return null;
  }

  const row: EthUsdSnapshotRow = {
    fetched_at: at.toISOString(),
    price_usd: observation.priceUsd,
    source: observation.source,
  };
  await deps.store.write(row);
  return row;
}

export interface EthUsdPollerDeps {
  store: EthUsdStore;
  /** RPC chain-id probe (viem `getChainId`) — the 4663-mainnet gate. */
  getChainId(): Promise<number>;
  /** Aggregator reader for the configured feed (viem public client in prod). */
  chainlinkClient: AggregatorReader;
  env: EthUsdEnvConfig;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export interface EthUsdPollerHandle {
  stop(): void;
  /** Which branch was selected at startup (observability/testing). */
  readonly usingChainlink: boolean;
}

/**
 * Start the poller. Chainlink branch engages ONLY when the RPC serves
 * chain 4663 AND the feed is not `off` (LOCAL/TESTNET skip entirely);
 * when it engages, the assertions run first and THROW on failure
 * (fail-closed: the poller must not start, and the HTTP fallback must NOT
 * mask the misconfiguration — the caller lets the age alert page instead).
 */
export async function startEthUsdPoller(
  deps: EthUsdPollerDeps,
  intervalMs: number = deps.env.pollIntervalMs,
): Promise<EthUsdPollerHandle> {
  const log = deps.logger ?? console;

  let chainlink: EthUsdTickDeps["chainlink"];
  if (deps.env.chainlinkFeed === "off") {
    log.log(`[eth-usd] chainlink branch disabled via CHAINLINK_ETH_USD_FEED=off — HTTP fallback only (LOCAL/TESTNET).`);
  } else {
    const chainId = await deps.getChainId();
    if (chainId !== 4663) {
      log.log(`[eth-usd] RPC chain id ${chainId} != 4663 — chainlink branch skipped, HTTP fallback only ().`);
    } else {
      // 4663 mainnet + feed configured ⇒ MANDATORY fail-closed assertions.
      await assertChainlinkFeed(deps.chainlinkClient, deps.env.chainlinkFeed);
      chainlink = { client: deps.chainlinkClient, feed: deps.env.chainlinkFeed };
      log.log(`[eth-usd] chainlink feed ${deps.env.chainlinkFeed} verified (description + decimals).`);
    }
  }

  const tickDeps: EthUsdTickDeps = {
    store: deps.store,
    chainlink,
    httpUrl: deps.env.sourceUrl,
    stalenessSeconds: deps.env.stalenessSeconds,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
    logger: deps.logger,
  };
  void runEthUsdTick(tickDeps);
  const timer = setInterval(() => void runEthUsdTick(tickDeps), intervalMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  return { stop: () => clearInterval(timer), usingChainlink: chainlink !== undefined };
}

/** Prod wiring: viem public client over the indexer's HTTP RPC (same pattern
 *  as confirmationStore.createRpcTagFetcher). Satisfies both the chain-id gate
 *  and the structural {@link AggregatorReader}. */
export function createEthUsdRpc(rpcHttp: string): {
  getChainId(): Promise<number>;
  reader: AggregatorReader;
} {
  const client = createPublicClient({ transport: http(rpcHttp) });
  return {
    getChainId: () => client.getChainId(),
    reader: {
      readContract: (args) =>
        client.readContract({ abi: args.abi, address: args.address, functionName: args.functionName }),
    },
  };
}
