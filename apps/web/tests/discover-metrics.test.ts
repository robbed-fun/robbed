import { GLOBAL_METRICS, type WsMessage, type WsTokenMetricsData } from "@robbed/shared";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  applyMetricToList,
  ingestMetricMessage,
  patchTokensQueryData,
  type TokensPage,
} from "@/views/discover/model/metrics";
import { qk } from "@/shared/lib/query-keys";

import { tokenCard } from "./fixtures";

const TOKEN = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000cc";

function metric(over: Partial<WsTokenMetricsData> = {}): WsTokenMetricsData {
  return {
    token: TOKEN,
    priceEth: 0.0005,
    mcapEth: "9900000000000000000", // 9.9 ETH — a swap moved mcap up
    volume24h: "4200000000000000000", // 4.2 ETH
    change24hPct: 21.5,
    progressPct: 0.73,
    status: "curve",
    graduated: false,
    blockNumber: 100,
    ts: 1_800_000_000,
    ...over,
  };
}

function metricMsg(data: WsTokenMetricsData): WsMessage {
  return { v: 1, type: "token_metrics", channel: GLOBAL_METRICS, seq: 1, ts: data.ts, data };
}

describe("applyMetricToList", () => {
  it("patches ONLY the matching token immutably and preserves order (no re-rank)", () => {
    const a = tokenCard({ address: TOKEN, mcapEth: "1000000000000000000", progressPct: 0.1 });
    const b = tokenCard({ address: OTHER, mcapEth: "2000000000000000000", progressPct: 0.2 });
    const list = [a, b];

    const next = applyMetricToList(list, metric());

    expect(next).not.toBe(list); // new array (something changed)
    expect(next[0]?.address).toBe(TOKEN); // order preserved
    expect(next[1]).toBe(b); // untouched token keeps its reference
    // matching token got the authoritative aggregates
    expect(next[0]?.mcapEth).toBe("9900000000000000000");
    expect(next[0]?.volume24h).toBe("4200000000000000000");
    expect(next[0]?.change24hPct).toBe(21.5);
    expect(next[0]?.progressPct).toBe(0.73);
    // the original object was not mutated (immutable update)
    expect(a.mcapEth).toBe("1000000000000000000");
  });

  it("returns the SAME reference when the token is absent (skips re-render)", () => {
    const list = [tokenCard({ address: OTHER })];
    expect(applyMetricToList(list, metric())).toBe(list);
  });
});

describe("patchTokensQueryData", () => {
  it("patches the infinite-query shape ({ pages }) at the right page", () => {
    const infinite = {
      pages: [
        { tokens: [tokenCard({ address: TOKEN, mcapEth: "1" })], nextCursor: "c1" },
        { tokens: [tokenCard({ address: OTHER, mcapEth: "2" })], nextCursor: null },
      ] as TokensPage[],
      pageParams: [undefined, "c1"],
    };
    const next = patchTokensQueryData(infinite, metric()) as typeof infinite;
    expect(next).not.toBe(infinite);
    expect(next.pages[0]?.tokens[0]?.mcapEth).toBe("9900000000000000000");
    expect(next.pages[1]).toBe(infinite.pages[1]); // untouched page keeps its ref
  });

  it("patches the plain shape ({ tokens, nextCursor }) and no-ops on no match", () => {
    const plain: TokensPage = { tokens: [tokenCard({ address: TOKEN })], nextCursor: null };
    const next = patchTokensQueryData(plain, metric()) as TokensPage;
    expect(next.tokens[0]?.mcapEth).toBe("9900000000000000000");

    const noMatch: TokensPage = { tokens: [tokenCard({ address: OTHER })], nextCursor: null };
    expect(patchTokensQueryData(noMatch, metric())).toBe(noMatch);
  });
});

describe("ingestMetricMessage — WS → cache reconciliation (the swap-freshness fix)", () => {
  const GRID_TRENDING = qk.tokens({ scope: "discover-grid", sort: "trending", filter: "all" });
  // A SECOND cached grid query (e.g. the user visited the "newest" sort tab too):
  // proves `setQueriesData` patches EVERY `tokens`-family query, not just one.
  const GRID_NEWEST = qk.tokens({ scope: "discover-grid", sort: "newest", filter: "all" });

  function seed() {
    const qc = new QueryClient();
    for (const key of [GRID_TRENDING, GRID_NEWEST]) {
      qc.setQueryData(key, {
        pages: [{ tokens: [tokenCard({ address: TOKEN, mcapEth: "1" })], nextCursor: null }],
        pageParams: [undefined],
      });
    }
    return qc;
  }

  const readMcap = (qc: QueryClient, key: readonly unknown[]) =>
    qc.getQueryData<{ pages: TokensPage[] }>(key)?.pages[0]?.tokens[0]?.mcapEth;

  it("patches EVERY tokens-family cache by reference on a metric (all cached grids)", () => {
    const qc = seed();
    const applied = ingestMetricMessage(qc, new Map(), metricMsg(metric()));
    expect(applied).toBe(true);
    expect(readMcap(qc, GRID_TRENDING)).toBe("9900000000000000000");
    expect(readMcap(qc, GRID_NEWEST)).toBe("9900000000000000000");
  });

  it("last-write-wins: drops a stale (lower blockNumber) snapshot", () => {
    const qc = seed();
    const lastBlock = new Map<string, number>();

    expect(ingestMetricMessage(qc, lastBlock, metricMsg(metric({ blockNumber: 200, mcapEth: "5" })))).toBe(true);
    // an out-of-order older snapshot must NOT overwrite the newer aggregate
    expect(ingestMetricMessage(qc, lastBlock, metricMsg(metric({ blockNumber: 199, mcapEth: "3" })))).toBe(false);

    expect(readMcap(qc, GRID_TRENDING)).toBe("5");
  });

  it("ignores non-metric and malformed messages", () => {
    const qc = seed();
    const lastBlock = new Map<string, number>();
    // a different WS type on the same subscription surface
    expect(
      ingestMetricMessage(qc, lastBlock, {
        v: 1,
        type: "launch",
        channel: GLOBAL_METRICS,
        seq: 1,
        ts: 1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    ).toBe(false);
    // malformed token_metrics data → schema safeParse fails, dropped
    expect(
      ingestMetricMessage(qc, lastBlock, {
        v: 1,
        type: "token_metrics",
        channel: GLOBAL_METRICS,
        seq: 1,
        ts: 1,
        data: { token: "not-an-address" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    ).toBe(false);
  });
});
