import { describe, expect, test } from "bun:test";
import { KeeperMetrics } from "../src/metrics";
import { TreasuryFeeSweeper } from "../src/treasury-sweeper";
import { CURVE, FakeChain, FakeClock, FakeDb, FakeLogger } from "./fakes";
import type { Address } from "../src/types";

const TOKEN = "0xABCdef0000000000000000000000000000000002" as Address;

function build(chain: FakeChain, opts?: { db?: FakeDb; minSweepWei?: bigint; maxSweepAgeMs?: number }) {
  const metrics = new KeeperMetrics();
  const log = new FakeLogger();
  const clock = new FakeClock();
  const sweeper = new TreasuryFeeSweeper({
    chain,
    db: opts?.db ?? new FakeDb([], [{ token: TOKEN, curve: CURVE }]),
    metrics,
    log,
    clock,
    tuning: {
      minSweepWei: opts?.minSweepWei ?? 500n,
      maxSweepAgeMs: opts?.maxSweepAgeMs ?? 86_400_000,
      gasCap: 30_000_000n,
    },
  });
  return { sweeper, metrics, log, clock };
}

describe("treasury fee sweeper", () => {
  test("sweeps immediately when accrued fees reach the threshold", async () => {
    const chain = new FakeChain({ treasuryFees: [500n], receipts: [{ status: "success" }], sweepSends: ["0xsweep1"] });
    const { sweeper, metrics, log } = build(chain, { minSweepWei: 500n });

    const results = await sweeper.sweep();

    expect(results).toEqual([{ curve: CURVE.toLowerCase(), token: TOKEN, status: "swept", amountWei: 500n, txHash: "0xsweep1" }] as never);
    expect(chain.sweepSendCount).toBe(1);
    expect(metrics.snapshot().treasuryFeesSweptTotal).toBe(1);
    expect(log.has("info", "treasury_fees_swept")).toBe(true);
  });

  test("sweeps an existing nonzero balance on first observation even below threshold", async () => {
    const chain = new FakeChain({ treasuryFees: [42n], receipts: [{ status: "success" }] });
    const { sweeper } = build(chain, { minSweepWei: 500n });

    const results = await sweeper.sweep();
    expect(results).toHaveLength(1);
    const result = results[0]!;

    expect(result.status).toBe("swept");
    expect(result.amountWei).toBe(42n);
    expect(chain.sweepSendCount).toBe(1);
  });

  test("does not re-sweep small fees before the daily age window", async () => {
    const chain = new FakeChain({ treasuryFees: [10n, 20n], receipts: [{ status: "success" }] });
    const { sweeper, clock } = build(chain, { minSweepWei: 500n, maxSweepAgeMs: 86_400_000 });

    const first = await sweeper.sweep();
    expect(first).toHaveLength(1);
    expect(first[0]!.status).toBe("swept");
    clock.advance(1_000);
    const results = await sweeper.sweep();
    expect(results).toHaveLength(1);
    const result = results[0]!;

    expect(result.status).toBe("below_threshold");
    expect(result.amountWei).toBe(20n);
    expect(chain.sweepSendCount).toBe(1);
  });

  test("sweeps small fees once the daily age window has elapsed", async () => {
    const chain = new FakeChain({ treasuryFees: [0n, 20n], receipts: [{ status: "success" }] });
    const { sweeper, clock } = build(chain, { minSweepWei: 500n, maxSweepAgeMs: 86_400_000 });

    const first = await sweeper.sweep();
    expect(first).toHaveLength(1);
    expect(first[0]!.status).toBe("no_fees");
    clock.advance(86_400_001);
    const results = await sweeper.sweep();
    expect(results).toHaveLength(1);
    const result = results[0]!;

    expect(result.status).toBe("swept");
    expect(result.amountWei).toBe(20n);
    expect(chain.sweepSendCount).toBe(1);
  });

  test("skips when the fee read is unavailable", async () => {
    const chain = new FakeChain({ treasuryFees: [null] });
    const { sweeper, log } = build(chain);

    const results = await sweeper.sweep();
    expect(results).toHaveLength(1);
    const result = results[0]!;

    expect(result.status).toBe("fee_read_unavailable");
    expect(chain.sweepSendCount).toBe(0);
    expect(log.has("warn", "treasury_fee_read_failed")).toBe(true);
  });

  test("reports failed when the tx does not succeed", async () => {
    const chain = new FakeChain({ treasuryFees: [500n], receipts: [{ status: "reverted" }] });
    const { sweeper, metrics, log } = build(chain);

    const results = await sweeper.sweep();
    expect(results).toHaveLength(1);
    const result = results[0]!;

    expect(result.status).toBe("failed");
    expect(metrics.snapshot().treasurySweepFailuresTotal).toBe(1);
    expect(log.has("warn", "treasury_fee_sweep_failed")).toBe(true);
  });
});
