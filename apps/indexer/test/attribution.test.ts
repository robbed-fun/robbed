/**
 * V3-leg trade attribution (D-75). Proves the swap handler keys `trader` (and
 * the best-effort cost-basis `holder`, which reuses the same `trader` value) on
 * the TRANSACTION-SENDER EOA (`event.transaction.from`), NOT `Swap.recipient`.
 *
 * The pure `v3SwapTrader` is exactly the derivation the `UniswapV3Pool:Swap`
 * handler calls (`const trader = v3SwapTrader(event)`), so asserting it here
 * asserts the handler's attribution without the Ponder virtual-module runtime.
 */
import { describe, expect, it } from "bun:test";
import { v3SwapTrader } from "../src/attribution";

const EOA = "0x1111111111111111111111111111111111111111";
// SwapRouter02 (D-28 mainnet address), the address `Swap.recipient` carries on
// an ETH-output sell — the pre-D-75 (buggy) attribution target.
const ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2";

/**
 * Minimal V3 `Swap` event-like fixture. Mirrors the fields the handler reads:
 * `transaction.from` (the EOA, D-75) and `args.recipient` (deliberately the
 * router on a sell) — `v3SwapTrader` must ignore the latter.
 */
function swapEvent(opts: { from: string; recipient: string }) {
  return {
    args: { recipient: opts.recipient },
    transaction: { from: opts.from, hash: "0xabc" },
  };
}

describe("v3SwapTrader — D-75 attribution keys on tx-sender EOA", () => {
  it("SELL: recipient is the router but trader = tx.from (EOA), NOT the router", () => {
    // ETH-output sell: `recipient` = SwapRouter02, `transaction.from` = user EOA.
    const ev = swapEvent({ from: EOA, recipient: ROUTER });
    expect(v3SwapTrader(ev)).toBe(EOA);
    // The exact bug D-75 fixes: never the router.
    expect(v3SwapTrader(ev)).not.toBe(ROUTER);
  });

  it("BUY: still correct — trader = tx.from (EOA) when recipient is the EOA", () => {
    // Token-output buy: recipient is usually the EOA already; tx.from must win.
    const ev = swapEvent({ from: EOA, recipient: EOA });
    expect(v3SwapTrader(ev)).toBe(EOA);
  });

  it("normalizes the tx-sender to lowercase (addresses stored lowercase)", () => {
    const CHECKSUMMED = "0xAbCdEf0000000000000000000000000000000001";
    const ev = swapEvent({ from: CHECKSUMMED, recipient: ROUTER });
    expect(v3SwapTrader(ev)).toBe(CHECKSUMMED.toLowerCase());
  });

  it("ignores recipient entirely — differing recipients yield the same trader", () => {
    const viaRouter = v3SwapTrader(swapEvent({ from: EOA, recipient: ROUTER }));
    const viaEoa = v3SwapTrader(swapEvent({ from: EOA, recipient: EOA }));
    expect(viaRouter).toBe(viaEoa);
  });
});
