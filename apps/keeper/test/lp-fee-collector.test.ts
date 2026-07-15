import { describe, expect, test } from "bun:test";
import { LpFeeCollector } from "../src/lp-fee-collector";
import { KeeperMetrics } from "../src/metrics";
import { FakeChain, FakeClock, FakeDb, FakeLogger, POOL } from "./fakes";
import type { Address, GraduatedLpPosition } from "../src/types";

const TOKEN = "0xABCdef0000000000000000000000000000000002" as Address;
const VAULT = "0xABCdef0000000000000000000000000000000004" as Address;

const position = (over: Partial<GraduatedLpPosition> = {}): GraduatedLpPosition => ({
  token: TOKEN,
  pool: POOL,
  lpTokenId: 70n,
  tokenIsToken0: true,
  ...over,
});

function build(
  chain: FakeChain,
  opts?: { db?: FakeDb; minCollectWethWei?: bigint; maxCollectAgeMs?: number },
) {
  const metrics = new KeeperMetrics();
  const log = new FakeLogger();
  const clock = new FakeClock();
  const collector = new LpFeeCollector({
    chain,
    db: opts?.db ?? new FakeDb([], [], [position()]),
    metrics,
    log,
    clock,
    tuning: {
      vault: VAULT,
      minCollectWethWei: opts?.minCollectWethWei ?? 500n,
      maxCollectAgeMs: opts?.maxCollectAgeMs ?? 86_400_000,
      gasCap: 30_000_000n,
    },
  });
  return { collector, metrics, log, clock };
}

describe("LP fee collector", () => {
  test("collects immediately when the simulated WETH leg reaches the threshold", async () => {
    const chain = new FakeChain({
      lpFeeQuotes: [{ amount0: 0n, amount1: 500n }],
      receipts: [{ status: "success" }],
      lpCollectSends: ["0xcollect1"],
    });
    const { collector, metrics, log } = build(chain, { minCollectWethWei: 500n });

    const results = await collector.collect();

    expect(results).toEqual([
      {
        token: TOKEN,
        pool: POOL,
        lpTokenId: 70n,
        status: "collected",
        amount0: 0n,
        amount1: 500n,
        wethAmount: 500n,
        txHash: "0xcollect1",
      },
    ] as never);
    expect(chain.lpCollectSendCount).toBe(1);
    expect(metrics.snapshot().lpFeesCollectedTotal).toBe(1);
    expect(log.has("info", "lp_fees_collected")).toBe(true);
  });

  test("collects an existing nonzero balance on first observation even below threshold", async () => {
    const chain = new FakeChain({
      lpFeeQuotes: [{ amount0: 0n, amount1: 42n }],
      receipts: [{ status: "success" }],
    });
    const { collector } = build(chain, { minCollectWethWei: 500n });

    const results = await collector.collect();

    expect(results[0]!.status).toBe("collected");
    expect(results[0]!.wethAmount).toBe(42n);
    expect(chain.lpCollectSendCount).toBe(1);
  });

  test("does not re-collect small fees before the daily age window", async () => {
    const chain = new FakeChain({
      lpFeeQuotes: [
        { amount0: 0n, amount1: 10n },
        { amount0: 0n, amount1: 20n },
      ],
      receipts: [{ status: "success" }],
    });
    const { collector, clock } = build(chain, {
      minCollectWethWei: 500n,
      maxCollectAgeMs: 86_400_000,
    });

    expect((await collector.collect())[0]!.status).toBe("collected");
    clock.advance(1_000);
    const results = await collector.collect();

    expect(results[0]!.status).toBe("below_threshold");
    expect(results[0]!.wethAmount).toBe(20n);
    expect(chain.lpCollectSendCount).toBe(1);
  });

  test("collects small fees once the daily age window has elapsed", async () => {
    const chain = new FakeChain({
      lpFeeQuotes: [
        { amount0: 0n, amount1: 0n },
        { amount0: 0n, amount1: 20n },
      ],
      receipts: [{ status: "success" }],
    });
    const { collector, clock } = build(chain, {
      minCollectWethWei: 500n,
      maxCollectAgeMs: 86_400_000,
    });

    expect((await collector.collect())[0]!.status).toBe("no_fees");
    clock.advance(86_400_001);
    const results = await collector.collect();

    expect(results[0]!.status).toBe("collected");
    expect(results[0]!.wethAmount).toBe(20n);
    expect(chain.lpCollectSendCount).toBe(1);
  });

  test("skips when collect simulation is unavailable", async () => {
    const chain = new FakeChain({ lpFeeQuotes: [null] });
    const { collector, log } = build(chain);

    const results = await collector.collect();

    expect(results[0]!.status).toBe("fee_read_unavailable");
    expect(chain.lpCollectSendCount).toBe(0);
    expect(log.has("warn", "lp_fee_collect_read_failed")).toBe(true);
  });

  test("reports failed when the tx does not succeed", async () => {
    const chain = new FakeChain({
      lpFeeQuotes: [{ amount0: 0n, amount1: 500n }],
      receipts: [{ status: "reverted" }],
    });
    const { collector, metrics, log } = build(chain);

    const results = await collector.collect();

    expect(results[0]!.status).toBe("failed");
    expect(metrics.snapshot().lpFeeCollectFailuresTotal).toBe(1);
    expect(log.has("warn", "lp_fee_collect_failed")).toBe(true);
  });
});
