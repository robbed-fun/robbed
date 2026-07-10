import type { InfiniteData } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { type TokensPage, patchTradePrice } from "@/widgets/token-grid/model/live";
import { tokenCard } from "./fixtures";

/**
 * WS-driven grid cache patch (§5.1 live updates; §2 no client market math).
 * Proves the reconciliation the DoD asks for on the Discover surface:
 * a `global:trades` message patches ONLY the indexer's `priceEth` onto the
 * matching card, never fabricates aggregates, never drops/reorders cards.
 */
function makeData(): InfiniteData<TokensPage> {
  return {
    pages: [
      {
        tokens: [
          tokenCard({ address: "0x00000000000000000000000000000000000000a1", priceEth: 1 }),
          tokenCard({ address: "0x00000000000000000000000000000000000000a2", priceEth: 2 }),
        ],
        nextCursor: "cursor-1",
      },
      {
        tokens: [
          tokenCard({ address: "0x00000000000000000000000000000000000000a3", priceEth: 3 }),
        ],
        nextCursor: null,
      },
    ],
    pageParams: [undefined, "cursor-1"],
  };
}

describe("patchTradePrice", () => {
  it("replaces priceEth on the matching card only, from the payload", () => {
    const before = makeData();
    const after = patchTradePrice(before, "0x00000000000000000000000000000000000000a2", 2.5)!;

    expect(after.pages[0]!.tokens[1]!.priceEth).toBe(2.5);
    // Sibling + other page untouched (same values, not recomputed).
    expect(after.pages[0]!.tokens[0]!.priceEth).toBe(1);
    expect(after.pages[1]!.tokens[0]!.priceEth).toBe(3);
    // No card dropped or reordered.
    expect(after.pages[0]!.tokens.length).toBe(2);
    expect(after.pages[1]!.tokens.length).toBe(1);
  });

  it("does NOT touch mcap/progress/Δ% (those are indexer aggregates, not derived)", () => {
    const before = makeData();
    const target = before.pages[0]!.tokens[0]!;
    const after = patchTradePrice(before, target.address, 9)!;
    const patched = after.pages[0]!.tokens[0]!;
    expect(patched.mcap).toBe(target.mcap);
    expect(patched.progressPct).toBe(target.progressPct);
    expect(patched.change24hPct).toBe(target.change24hPct);
    expect(patched.volume24h).toBe(target.volume24h);
  });

  it("is a no-op (same reference) for an unknown token", () => {
    const before = makeData();
    const after = patchTradePrice(before, "0x0000000000000000000000000000000000009999", 5);
    expect(after).toBe(before);
  });

  it("is a no-op when priceEth is unchanged", () => {
    const before = makeData();
    const after = patchTradePrice(before, before.pages[0]!.tokens[0]!.address, 1);
    expect(after).toBe(before);
  });

  it("returns undefined when the cache is empty", () => {
    expect(patchTradePrice(undefined, "0xabc", 1)).toBeUndefined();
  });
});
