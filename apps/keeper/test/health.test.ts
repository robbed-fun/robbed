import { describe, expect, test } from "bun:test";
import { buildHealthBody, type WalletState } from "../src/health";
import { GraduationKeeper } from "../src/keeper";
import { KeeperMetrics } from "../src/metrics";
import { FakeChain, FakeDb, FakeLogger } from "./fakes";

function harness() {
  const metrics = new KeeperMetrics();
  const keeper = new GraduationKeeper({
    chain: new FakeChain(),
    db: new FakeDb(),
    metrics,
    log: new FakeLogger(),
    clock: { now: () => 1_000_000, sleep: async () => {} },
  });
  return { metrics, keeper };
}

const wallet = (over: Partial<WalletState> = {}): WalletState => ({
  address: "0xkeeper",
  balanceWei: 1_000_000_000_000_000_000n,
  warnThresholdWei: 10_000_000_000_000_000n,
  low: false,
  updatedAt: 1_000_000,
  ...over,
});

describe("healthz body", () => {
  test("ok when balance healthy and sweeps recent", () => {
    const { metrics, keeper } = harness();
    metrics.recordSweep(999_500, 3);
    const { status, body } = buildHealthBody({
      port: 3003,
      keeper,
      metrics,
      getWallet: () => wallet(),
      detection: "ws-subscription",
      stalenessMs: 60_000,
      now: () => 1_000_000,
    });
    expect(status).toBe("ok");
    expect((body as { detection: string }).detection).toBe("ws-subscription");
    // bigints are serialized as strings for JSON safety.
    expect((body as { wallet: { balanceWei: string } }).wallet.balanceWei).toBe("1000000000000000000");
  });

  test("degraded (still 200) when wallet balance is low", () => {
    const { metrics, keeper } = harness();
    metrics.recordSweep(1_000_000, 0);
    const { status } = buildHealthBody({
      port: 3003,
      keeper,
      metrics,
      getWallet: () => wallet({ low: true }),
      detection: "ws-subscription",
      stalenessMs: 60_000,
      now: () => 1_000_000,
    });
    expect(status).toBe("degraded");
  });

  test("stale (→503) when the sweep loop has not run within the window", () => {
    const { metrics, keeper } = harness();
    metrics.recordSweep(100_000, 0); // long ago
    const { status } = buildHealthBody({
      port: 3003,
      keeper,
      metrics,
      getWallet: () => wallet(),
      detection: "http-polling",
      stalenessMs: 60_000,
      now: () => 1_000_000,
    });
    expect(status).toBe("stale");
  });
});
