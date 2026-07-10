import { describe, expect, it } from "bun:test";
import { BalanceLedger, holderCountDelta, isZeroAddress } from "../src/balances";

const T = "0xtoken";
const A = "0x" + "a1".repeat(20);
const B = "0x" + "b2".repeat(20);
const ZERO = "0x" + "00".repeat(20);

describe("holderCountDelta — the shared 0↔positive transition rule", () => {
  it("+1 crossing 0 → positive", () => expect(holderCountDelta(0n, 5n)).toBe(1));
  it("-1 crossing positive → 0", () => expect(holderCountDelta(5n, 0n)).toBe(-1));
  it("0 staying positive", () => expect(holderCountDelta(5n, 3n)).toBe(0));
  it("0 staying zero", () => expect(holderCountDelta(0n, 0n)).toBe(0));
  it("-1 crossing positive → negative (defensive)", () => expect(holderCountDelta(3n, -1n)).toBe(-1));
});

describe("BalanceLedger — Transfer is the sole balance truth", () => {
  it("mint from zero credits the receiver and counts one holder; zero is untracked", () => {
    const l = new BalanceLedger();
    l.applyTransfer(T, ZERO, A, 100n, 1000);
    expect(l.getState(T, A)!.balance).toBe(100n);
    expect(l.getState(T, ZERO)).toBeUndefined();
    expect(l.getHolderCount(T)).toBe(1);
  });

  it("transfer between holders moves balance and updates holder_count on 0-crossings", () => {
    const l = new BalanceLedger();
    l.applyTransfer(T, ZERO, A, 100n, 1000); // A=100, holders=1
    l.applyTransfer(T, A, B, 100n, 1001); // A=0 (-1), B=100 (+1) → holders=1
    expect(l.getState(T, A)!.balance).toBe(0n);
    expect(l.getState(T, B)!.balance).toBe(100n);
    expect(l.getHolderCount(T)).toBe(1);
  });

  it("burn to zero decrements the sender and holder_count", () => {
    const l = new BalanceLedger();
    l.applyTransfer(T, ZERO, A, 100n, 1000);
    l.applyTransfer(T, A, ZERO, 100n, 1002); // A → 0
    expect(l.getState(T, A)!.balance).toBe(0n);
    expect(l.getHolderCount(T)).toBe(0);
  });
});

describe("cost-basis columns are DISJOINT from balance (X-4 balance-write ownership)", () => {
  it("cost-basis writes never touch balance; transfers never touch cost-basis", () => {
    const l = new BalanceLedger();
    // Trade/Swap path: cost-basis only.
    l.applyCostBasisBuy(T, A, 10n, 100n, 1000);
    expect(l.getState(T, A)!.balance).toBe(0n); // NOT written by cost-basis
    expect(l.getState(T, A)!.totalBought).toBe(10n);
    expect(l.getState(T, A)!.ethIn).toBe(100n);

    // Transfer path: balance only.
    l.applyTransfer(T, ZERO, A, 10n, 1001);
    expect(l.getState(T, A)!.balance).toBe(10n);
    expect(l.getState(T, A)!.totalBought).toBe(10n); // unchanged by transfer

    // Sell cost-basis.
    l.applyCostBasisSell(T, A, 4n, 40n, 1002);
    expect(l.getState(T, A)!.totalSold).toBe(4n);
    expect(l.getState(T, A)!.ethOut).toBe(40n);
    expect(l.getState(T, A)!.balance).toBe(10n); // still only Transfer-driven
  });
});

describe("isZeroAddress", () => {
  it("matches the zero address case-insensitively", () => {
    expect(isZeroAddress(ZERO)).toBe(true);
    expect(isZeroAddress(A)).toBe(false);
  });
});

describe("topHolders — top-N by balance, excludes zero-balance", () => {
  it("orders holders by balance descending", () => {
    const l = new BalanceLedger();
    l.applyTransfer(T, ZERO, A, 30n, 1);
    l.applyTransfer(T, ZERO, B, 70n, 1);
    const top = l.topHolders(T, 20);
    expect(top.map((h) => h.holder)).toEqual([B, A]);
    expect(top[0]!.balance).toBe(70n);
  });
});
