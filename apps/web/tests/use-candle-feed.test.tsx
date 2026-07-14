import type { Candle } from "@robbed/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bug 1 (design-decisions D-72): the SSR `initialData` (candles for the MOUNT
 * interval only) must seed ONLY that interval's query. Docs-first (TanStack Query
 * v5 "Initial Query Data", verified 2026-07-14): `initialData` is persisted to the
 * cache PER queryKey and treated as fresh subject to `staleTime`, which SUPPRESSES
 * the mount fetch — so seeding it into every interval froze inactive intervals on
 * the wrong seed and no `/candles` request fired on tab-switch. These tests prove
 * the mount interval is served from the seed WITHOUT a network call, while a
 * different interval fetches and renders the returned candle.
 */

const { getCandles } = vi.hoisted(() => ({ getCandles: vi.fn() }));
vi.mock("@/shared/api", () => ({ getCandles }));

import { useCandleFeed } from "@/widgets/price-chart/model/use-candle-feed";

function candle(bucketStart: number): Candle {
  return {
    bucketStart,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volumeEth: "1000000000000000000",
    volumeToken: "1000000000000000000000",
    tradeCount: 1,
  };
}

const ADDR = "0x00000000000000000000000000000000000000aa";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => getCandles.mockReset());

describe("useCandleFeed — SSR seed only its own interval (Bug 1, D-72)", () => {
  it("serves the MOUNT interval from the SSR seed WITHOUT a re-fetch", async () => {
    getCandles.mockResolvedValue({ candles: [] });
    const seed = { candles: [candle(100)] };

    const { result } = renderHook(
      () => useCandleFeed(ADDR, "1m", { initialInterval: "1m", initialData: seed, anchorSec: 1 }),
      { wrapper: wrapper() },
    );

    // initialData is fresh (staleTime 5s) → served immediately, no network.
    expect(result.current.data).toEqual(seed);
    await new Promise((r) => setTimeout(r, 20));
    expect(getCandles).not.toHaveBeenCalled();
  });

  it("does NOT seed a DIFFERENT interval — it fetches and renders the returned candle", async () => {
    getCandles.mockResolvedValue({ candles: [candle(200)] });
    const seed = { candles: [] }; // the SSR seed belongs to the mount interval only

    const { result } = renderHook(
      () => useCandleFeed(ADDR, "1h", { initialInterval: "1m", initialData: seed, anchorSec: 1 }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(getCandles).toHaveBeenCalled());
    await waitFor(() => expect(result.current.data?.candles).toHaveLength(1));
    expect(result.current.data?.candles[0]!.bucketStart).toBe(200);
  });
});
