import { describe, expect, it } from "vitest";
import type { WsMessage } from "@robbed/shared";

import { applyGraduated, tradeImpliesGraduation } from "@/entities/token";

import { tokenDetail } from "./fixtures";

/**
 * TD-6 venue-flip reconciliation rules (§5.2/§12.12/§2.1) — the pure model
 * behind `useLiveTokenDetail`. The wiring (WS subscription → cache patch →
 * invalidate → REST truth; reconnect refetch) is proven end-to-end by
 * e2e/flows/td-6.spec.ts + tests/ws-reconnect.test.ts; these units pin the
 * decision rules themselves.
 */

const POOL = "0x00000000000000000000000000000000000000d3";

function tradeMsg(venue: "curve" | "v3"): WsMessage {
  return {
    v: 1,
    type: "trade",
    channel: "token:0x00000000000000000000000000000000000000a1:trades",
    seq: 7,
    ts: 1_752_300_000_000,
    data: {
      token: "0x00000000000000000000000000000000000000a1",
      trader: "0x00000000000000000000000000000000000000ee",
      venue,
      isBuy: true,
      ethAmount: "420000000000000000",
      tokenAmount: "1000000000000000000000",
      feeEth: "4200000000000000",
      priceEth: 0.00000042,
      blockNumber: 123,
      txHash: `0x${"ab".repeat(32)}`,
      logIndex: 0,
      blockTimestamp: 1_752_300_000,
      confirmationState: "soft_confirmed",
    },
  };
}

describe("applyGraduated (WS `graduated` → venue flip)", () => {
  it("flips a graduating token to the graduated V3 venue with the pool wired", () => {
    const before = tokenDetail({ status: "graduating", graduated: false });
    const after = applyGraduated(before, POOL);
    expect(after.status).toBe("graduated");
    expect(after.graduated).toBe(true);
    expect(after.v3PoolAddress).toBe(POOL);
    // Everything else is untouched — the indexed refetch supplies the rest.
    expect(after.address).toBe(before.address);
    expect(after.graduation).toEqual(before.graduation);
  });

  it("also flips straight from the curve status (event may outrun the graduating projection)", () => {
    const after = applyGraduated(tokenDetail({ status: "curve" }), POOL);
    expect(after.status).toBe("graduated");
  });

  it("does not mutate the input (cache-safe)", () => {
    const before = tokenDetail({ status: "graduating" });
    applyGraduated(before, POOL);
    expect(before.status).toBe("graduating");
    expect(before.v3PoolAddress).toBeUndefined();
  });
});

describe("tradeImpliesGraduation (v3 trade while venue still curve → reconcile)", () => {
  it("true for a v3-venue trade against a curve/graduating token", () => {
    expect(tradeImpliesGraduation(tokenDetail({ status: "curve" }), tradeMsg("v3"))).toBe(true);
    expect(
      tradeImpliesGraduation(tokenDetail({ status: "graduating" }), tradeMsg("v3")),
    ).toBe(true);
  });

  it("false when already graduated, for curve trades, or without a cached token", () => {
    expect(
      tradeImpliesGraduation(tokenDetail({ status: "graduated", graduated: true }), tradeMsg("v3")),
    ).toBe(false);
    expect(tradeImpliesGraduation(tokenDetail({ status: "curve" }), tradeMsg("curve"))).toBe(
      false,
    );
    expect(tradeImpliesGraduation(undefined, tradeMsg("v3"))).toBe(false);
  });
});
