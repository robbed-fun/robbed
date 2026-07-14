/**
 * ETH/USD poller suite (indexer.md).
 *
 * Covers the task-mandated cases: fresh Chainlink answer accepted + labeled
 * `chainlink:4663`; stale answer rejected → HTTP fallback; assertion
 * failure fail-closed (throws, poller never starts); non-4663 chain skips the
 * Chainlink branch entirely. Plus: all-source failure writes NOTHING (never a
 * fabricated price), HTTP parser shapes (DefiLlama/Coinbase), env loading.
 */
import { describe, expect, it } from "bun:test";
import {
  CHAINLINK_SOURCE_LABEL,
  assertChainlinkFeed,
  fetchHttpPrice,
  httpSourceLabel,
  loadEthUsdEnv,
  parseHttpPrice,
  readChainlinkPrice,
  runEthUsdTick,
  startEthUsdPoller,
  type AggregatorReader,
  type EthUsdStore,
} from "../src/jobs/ethUsd";
import type { EthUsdSnapshotRow } from "@robbed/shared";
// ABI + feed address are the SHARED exports (adopted by robbed-shared
// 2026-07-11) — asserted against directly so shape changes break loudly HERE
// too, not only in packages/shared.
import { CHAINLINK_ETH_USD_PROXY_4663 } from "@robbed/shared";
import { aggregatorV3Abi } from "@robbed/shared/abi";

const FEED = CHAINLINK_ETH_USD_PROXY_4663 as `0x${string}`;
const NOW = new Date("2026-07-11T16:00:00.000Z");
const NOW_SEC = Math.floor(NOW.getTime() / 1000);
const silent = { log() {}, warn() {}, error() {} };

/** Stub aggregator: healthy ETH/USD feed unless overridden. */
function stubAggregator(overrides?: {
  description?: unknown;
  decimals?: unknown;
  round?: readonly [bigint, bigint, bigint, bigint, bigint];
  fail?: boolean;
}): AggregatorReader {
  return {
    async readContract({ functionName }) {
      if (overrides?.fail) throw new Error("execution reverted (no code at address)");
      switch (functionName) {
        case "description":
          return overrides?.description ?? "ETH / USD";
        case "decimals":
          return overrides?.decimals ?? 8;
        case "latestRoundData":
          // fresh round, $1,815.64468052 @ 8 decimals, updated 60s ago
          return (
            overrides?.round ?? [1n, 181564468052n, BigInt(NOW_SEC - 60), BigInt(NOW_SEC - 60), 1n]
          );
      }
    },
  };
}

function captureStore() {
  const rows: EthUsdSnapshotRow[] = [];
  const store: EthUsdStore = {
    async write(row) {
      rows.push(row);
    },
  };
  return { store, rows };
}

function jsonFetch(body: unknown, ok = true): typeof fetch {
  return (async () =>
    ({ ok, json: async () => body }) as Response) as unknown as typeof fetch;
}

const failingFetch: typeof fetch = (async () => {
  throw new Error("network down");
}) as unknown as typeof fetch;

describe("loadEthUsdEnv", () => {
  it("defaults the feed to the recorded proxy for 4663", () => {
    const env = loadEthUsdEnv({});
    expect(env.chainlinkFeed).toBe(CHAINLINK_ETH_USD_PROXY_4663);
    expect(env.pollIntervalMs).toBe(30_000);
    expect(env.stalenessSeconds).toBe(3_600);
    expect(env.sourceUrl).toBeUndefined();
  });

  it("supports 'off' (LOCAL/TESTNET disable) and address override, rejects garbage", () => {
    expect(loadEthUsdEnv({ CHAINLINK_ETH_USD_FEED: "off" }).chainlinkFeed).toBe("off");
    const addr = "0x6091E64eb7138EEF066a80FD3A0d7427B91f2721";
    expect(loadEthUsdEnv({ CHAINLINK_ETH_USD_FEED: addr }).chainlinkFeed).toBe(addr.toLowerCase() as `0x${string}`);
    expect(() => loadEthUsdEnv({ CHAINLINK_ETH_USD_FEED: "not-an-address" })).toThrow();
  });
});

describe("assertChainlinkFeed — mandatory startup assertions", () => {
  it("passes on the verified shape (description 'ETH / USD', decimals 8)", async () => {
    await expect(assertChainlinkFeed(stubAggregator(), FEED)).resolves.toBeUndefined();
  });

  it("fail-closed on wrong description", async () => {
    await expect(
      assertChainlinkFeed(stubAggregator({ description: "BTC / USD" }), FEED),
    ).rejects.toThrow(/FAIL-CLOSED.*description/);
  });

  it("fail-closed on wrong decimals", async () => {
    await expect(assertChainlinkFeed(stubAggregator({ decimals: 18 }), FEED)).rejects.toThrow(
      /FAIL-CLOSED.*decimals/,
    );
  });

  it("fail-closed when the feed cannot be read (no contract at address)", async () => {
    await expect(assertChainlinkFeed(stubAggregator({ fail: true }), FEED)).rejects.toThrow(
      /FAIL-CLOSED.*cannot read/,
    );
  });
});

describe("readChainlinkPrice — staleness check", () => {
  it("accepts a fresh answer at 8 decimals with the chainlink:4663 label", async () => {
    const obs = await readChainlinkPrice(stubAggregator(), FEED, NOW.getTime(), 3600);
    expect(obs).not.toBeNull();
    expect(obs!.priceUsd).toBeCloseTo(1815.64468052, 6);
    expect(obs!.source).toBe(CHAINLINK_SOURCE_LABEL);
  });

  it("rejects an answer older than the staleness window", async () => {
    const staleAt = BigInt(NOW_SEC - 7200); // 2h old vs 1h window
    const obs = await readChainlinkPrice(
      stubAggregator({ round: [1n, 181564468052n, staleAt, staleAt, 1n] }),
      FEED,
      NOW.getTime(),
      3600,
    );
    expect(obs).toBeNull();
  });

  it("rejects incomplete rounds and non-positive answers (never fabricates)", async () => {
    const incomplete = await readChainlinkPrice(
      stubAggregator({ round: [1n, 181564468052n, 0n, 0n, 1n] }),
      FEED,
      NOW.getTime(),
      3600,
    );
    expect(incomplete).toBeNull();
    const negative = await readChainlinkPrice(
      stubAggregator({ round: [1n, -1n, BigInt(NOW_SEC), BigInt(NOW_SEC), 1n] }),
      FEED,
      NOW.getTime(),
      3600,
    );
    expect(negative).toBeNull();
  });
});

describe("HTTP fallback parsing + labeling", () => {
  it("parses the DefiLlama shape and labels 'defillama'", async () => {
    const obs = await fetchHttpPrice(
      "https://coins.llama.fi/prices/current/coingecko:ethereum",
      jsonFetch({ coins: { "coingecko:ethereum": { price: 1815.6, timestamp: NOW_SEC } } }),
    );
    expect(obs).toEqual({ priceUsd: 1815.6, source: "defillama" });
  });

  it("parses the Coinbase shape and labels 'coinbase'", async () => {
    const obs = await fetchHttpPrice(
      "https://api.coinbase.com/v2/prices/ETH-USD/spot",
      jsonFetch({ data: { amount: "1815.64", currency: "USD", base: "ETH" } }),
    );
    expect(obs).toEqual({ priceUsd: 1815.64, source: "coinbase" });
  });

  it("labels unknown hosts http:<host> and rejects garbage bodies", () => {
    expect(httpSourceLabel("https://example.com/price")).toBe("http:example.com");
    expect(parseHttpPrice({ coins: { x: { price: "not a number" } } })).toBeNull();
    expect(parseHttpPrice({ data: { amount: "zero" } })).toBeNull();
    expect(parseHttpPrice({ price: -5 })).toBeNull();
    expect(parseHttpPrice("1815")).toBeNull();
  });

  it("returns null on a non-2xx response", async () => {
    const obs = await fetchHttpPrice("https://coins.llama.fi/x", jsonFetch({}, false));
    expect(obs).toBeNull();
  });
});

describe("runEthUsdTick — source chain (Chainlink → HTTP → nothing)", () => {
  it("writes a chainlink:4663-labeled, timestamped row from a fresh answer", async () => {
    const { store, rows } = captureStore();
    const row = await runEthUsdTick({
      store,
      chainlink: { client: stubAggregator(), feed: FEED },
      httpUrl: undefined,
      stalenessSeconds: 3600,
      now: () => NOW,
      logger: silent,
    });
    expect(row).not.toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("chainlink:4663");
    expect(rows[0]!.fetched_at).toBe("2026-07-11T16:00:00.000Z");
    expect(rows[0]!.price_usd).toBeCloseTo(1815.64468052, 6);
  });

  it("stale chainlink answer → falls back to the documented HTTP chain", async () => {
    const { store, rows } = captureStore();
    const staleAt = BigInt(NOW_SEC - 7200);
    const row = await runEthUsdTick({
      store,
      chainlink: { client: stubAggregator({ round: [1n, 181564468052n, staleAt, staleAt, 1n] }), feed: FEED },
      httpUrl: "https://coins.llama.fi/prices/current/coingecko:ethereum",
      stalenessSeconds: 3600,
      fetchImpl: jsonFetch({ coins: { "coingecko:ethereum": { price: 1800.5 } } }),
      now: () => NOW,
      logger: silent,
    });
    expect(row).not.toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("defillama");
    expect(rows[0]!.price_usd).toBe(1800.5);
  });

  it("chainlink read error → HTTP fallback (runtime resilience, not fail-closed)", async () => {
    const { store, rows } = captureStore();
    const row = await runEthUsdTick({
      store,
      chainlink: { client: stubAggregator({ fail: true }), feed: FEED },
      httpUrl: "https://api.coinbase.com/v2/prices/ETH-USD/spot",
      stalenessSeconds: 3600,
      fetchImpl: jsonFetch({ data: { amount: "1799.01" } }),
      now: () => NOW,
      logger: silent,
    });
    expect(row).not.toBeNull();
    expect(rows[0]!.source).toBe("coinbase");
  });

  it("all sources failed → writes NOTHING (never a fabricated price)", async () => {
    const { store, rows } = captureStore();
    const staleAt = BigInt(NOW_SEC - 7200);
    const row = await runEthUsdTick({
      store,
      chainlink: { client: stubAggregator({ round: [1n, 181564468052n, staleAt, staleAt, 1n] }), feed: FEED },
      httpUrl: "https://coins.llama.fi/x",
      stalenessSeconds: 3600,
      fetchImpl: failingFetch,
      now: () => NOW,
      logger: silent,
    });
    expect(row).toBeNull();
    expect(rows).toHaveLength(0);
  });

  it("no sources configured at all → writes NOTHING", async () => {
    const { store, rows } = captureStore();
    const row = await runEthUsdTick({
      store,
      chainlink: undefined,
      httpUrl: undefined,
      stalenessSeconds: 3600,
      now: () => NOW,
      logger: silent,
    });
    expect(row).toBeNull();
    expect(rows).toHaveLength(0);
  });
});

describe("startEthUsdPoller — branch selection + fail-closed startup", () => {
  it("engages the chainlink branch on 4663 with a verified feed", async () => {
    const { store, rows } = captureStore();
    const poller = await startEthUsdPoller(
      {
        store,
        getChainId: async () => 4663,
        chainlinkClient: stubAggregator(),
        env: { chainlinkFeed: FEED, sourceUrl: undefined, pollIntervalMs: 1_000_000, stalenessSeconds: 3600 },
        now: () => NOW,
        logger: silent,
      },
      1_000_000,
    );
    poller.stop();
    expect(poller.usingChainlink).toBe(true);
    // first tick runs immediately (async) — give it a microtask turn
    await new Promise((r) => setTimeout(r, 0));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("chainlink:4663");
  });

  it("non-4663 chain SKIPS the chainlink branch entirely (LOCAL/TESTNET)", async () => {
    const { store, rows } = captureStore();
    // aggregator stub that would explode if touched — proves the branch is skipped
    const untouchable: AggregatorReader = {
      readContract: async () => {
        throw new Error("chainlink branch must not be touched off 4663");
      },
    };
    const poller = await startEthUsdPoller(
      {
        store,
        getChainId: async () => 46630, // testnet
        chainlinkClient: untouchable,
        env: {
          chainlinkFeed: FEED,
          sourceUrl: "https://coins.llama.fi/prices/current/coingecko:ethereum",
          pollIntervalMs: 1_000_000,
          stalenessSeconds: 3600,
        },
        fetchImpl: jsonFetch({ coins: { "coingecko:ethereum": { price: 1801.2 } } }),
        now: () => NOW,
        logger: silent,
      },
      1_000_000,
    );
    poller.stop();
    expect(poller.usingChainlink).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("defillama");
  });

  it("CHAINLINK_ETH_USD_FEED=off disables the branch without probing the chain", async () => {
    const { store } = captureStore();
    const poller = await startEthUsdPoller(
      {
        store,
        getChainId: async () => {
          throw new Error("must not probe chain id when feed=off");
        },
        chainlinkClient: stubAggregator(),
        env: { chainlinkFeed: "off", sourceUrl: undefined, pollIntervalMs: 1_000_000, stalenessSeconds: 3600 },
        now: () => NOW,
        logger: silent,
      },
      1_000_000,
    );
    poller.stop();
    expect(poller.usingChainlink).toBe(false);
  });

  it("assertion failure on 4663 is FAIL-CLOSED: throws, nothing written", async () => {
    const { store, rows } = captureStore();
    await expect(
      startEthUsdPoller(
        {
          store,
          getChainId: async () => 4663,
          chainlinkClient: stubAggregator({ description: "STETH / USD" }),
          env: {
            chainlinkFeed: FEED,
            sourceUrl: "https://coins.llama.fi/x", // present, but MUST NOT mask the misconfig
            pollIntervalMs: 1_000_000,
            stalenessSeconds: 3600,
          },
          fetchImpl: jsonFetch({ coins: { x: { price: 1 } } }),
          now: () => NOW,
          logger: silent,
        },
        1_000_000,
      ),
    ).rejects.toThrow(/FAIL-CLOSED/);
    await new Promise((r) => setTimeout(r, 0));
    expect(rows).toHaveLength(0);
  });
});

describe("aggregatorV3Abi shape (@robbed/shared/abi export — the single repo copy)", () => {
  it("carries exactly the three views the poller wires", () => {
    const names = aggregatorV3Abi.map((f) => f.name).sort();
    expect(names).toEqual(["decimals", "description", "latestRoundData"]);
  });
});
