import { describe, expect, test } from "bun:test";
import { GraduationKeeper } from "../src/keeper";
import { KeeperMetrics } from "../src/metrics";
import { CURVE, deferred, FakeChain, FakeClock, FakeDb, FakeLogger } from "./fakes";

function build(chain: FakeChain, opts?: { db?: FakeDb; maxAttempts?: number }) {
  const metrics = new KeeperMetrics();
  const log = new FakeLogger();
  const clock = new FakeClock();
  const keeper = new GraduationKeeper({
    chain,
    db: opts?.db ?? new FakeDb(),
    metrics,
    log,
    clock,
    tuning: { maxAttempts: opts?.maxAttempts ?? 3, gasCap: 30_000_000n, backoffBaseMs: 1, failedCooldownMs: 300_000 },
  });
  return { keeper, metrics, log, clock };
}

describe("happy path", () => {
  test("fires graduate() once and reports graduated", async () => {
    const chain = new FakeChain({ phases: ["ready"], receipts: [{ status: "success" }] });
    const { keeper, metrics } = build(chain);
    const r = await keeper.onReady(CURVE);
    expect(r.status).toBe("graduated");
    expect(chain.sendCount).toBe(1);
    expect(metrics.snapshot().graduatedTotal).toBe(1);
    expect(metrics.snapshot().failedPersistentTotal).toBe(0);
  });
});

describe("idempotency", () => {
  test("no double-send: a second trigger while one is in-flight is skipped", async () => {
    const gate = deferred<void>();
    const chain = new FakeChain({ phases: ["ready", "ready"], receipts: [{ status: "success" }], gate });
    const { keeper } = build(chain);

    const p1 = keeper.onReady(CURVE); // enters run(), blocks inside estimate on the gate
    await new Promise((r) => setTimeout(r, 0)); // let p1 reach the gate (inFlight now set)
    const r2 = await keeper.onReady(CURVE); // must be rejected by the in-flight guard
    expect(r2.status).toBe("skipped_in_flight");
    expect(chain.sendCount).toBe(0); // nothing sent yet — the gate still holds p1

    gate.resolve();
    const r1 = await p1;
    expect(r1.status).toBe("graduated");
    expect(chain.sendCount).toBe(1); // exactly one send across both triggers
  });

  test("pre-send phase re-check: a Trading curve (stale hint) is never sent", async () => {
    const chain = new FakeChain({ phases: ["trading"] });
    const { keeper, metrics } = build(chain);
    const r = await keeper.onReady(CURVE);
    expect(r.status).toBe("not_ready");
    expect(chain.sendCount).toBe(0);
    expect(metrics.snapshot().failedPersistentTotal).toBe(0);
  });

  test("already-Graduated at pre-check is a no-op success", async () => {
    const chain = new FakeChain({ phases: ["graduated"] });
    const { keeper, metrics } = build(chain);
    const r = await keeper.onReady(CURVE);
    expect(r.status).toBe("already_graduated");
    expect(chain.sendCount).toBe(0);
    expect(metrics.snapshot().alreadyGraduatedTotal).toBe(1);
  });
});

describe("already-graduated-by-someone-else classification", () => {
  test("our tx reverts but phase is now Graduated → SUCCESS, not failure", async () => {
    // pre-check ready → send → receipt reverted → re-read phase graduated.
    const chain = new FakeChain({ phases: ["ready", "graduated"], receipts: [{ status: "reverted" }] });
    const { keeper, metrics } = build(chain);
    const r = await keeper.onReady(CURVE);
    expect(r.status).toBe("already_graduated");
    expect(metrics.snapshot().alreadyGraduatedTotal).toBe(1);
    expect(metrics.snapshot().failedPersistentTotal).toBe(0); // NOT a failure
  });

  test("estimate reverts but phase is now Graduated → SUCCESS", async () => {
    const chain = new FakeChain({ phases: ["ready", "graduated"], estimates: [new Error("execution reverted")], classify: () => "contract_revert" });
    const { keeper, metrics } = build(chain);
    const r = await keeper.onReady(CURVE);
    expect(r.status).toBe("already_graduated");
    expect(chain.sendCount).toBe(0);
    expect(metrics.snapshot().alreadyGraduatedTotal).toBe(1);
  });
});

describe("revert classification", () => {
  test("transient error → retried, then succeeds (no persistent alert)", async () => {
    // attempt1: send throws transient; phase stays ready; classify → transient → retry.
    // attempt2: send ok, receipt success.
    const chain = new FakeChain({
      phases: ["ready", "ready"], // pre-check + post-throw re-read
      sends: [new Error("socket hang up")],
      receipts: [{ status: "success" }],
      classify: () => "transient",
    });
    const { keeper, metrics, log, clock } = build(chain);
    const r = await keeper.onReady(CURVE);
    expect(r.status).toBe("graduated");
    expect(chain.sendCount).toBe(2); // retried
    expect(metrics.snapshot().transientRetriesTotal).toBe(1);
    expect(metrics.snapshot().failedPersistentTotal).toBe(0);
    expect(log.has("error", "graduation_failed_persistent")).toBe(false);
    expect(clock.sleeps.length).toBe(1); // one backoff between the two attempts
  });

  test("persistent revert (phase stays ready) → distinct alert + cooldown, no hot-loop", async () => {
    // Every attempt: send ok, receipt reverted, phase re-read stays ready.
    const chain = new FakeChain({
      phases: ["ready"], // repeats 'ready' forever
      receipts: [{ status: "reverted" }, { status: "reverted" }, { status: "reverted" }],
    });
    const { keeper, metrics, log } = build(chain, { maxAttempts: 3 });
    const r = await keeper.onReady(CURVE);
    expect(r.status).toBe("failed_persistent");
    expect(chain.sendCount).toBe(3); // all attempts used
    expect(metrics.snapshot().failedPersistentTotal).toBe(1);
    expect(log.has("error", "graduation_failed_persistent")).toBe(true);
    // donation-brick alert marker present
    const alert = log.lines.find((l) => l.event === "graduation_failed_persistent");
    expect(alert?.fields?.alert).toBe("donation_brick_suspected");

    // cooldown active → a subsequent trigger does NOT re-fire (no hot-loop).
    expect(keeper.cooldownCount).toBe(1);
    const again = await keeper.onReady(CURVE);
    expect(again.status).toBe("skipped_cooldown");
    expect(chain.sendCount).toBe(3); // unchanged — cooldown suppressed the retry
  });

  test("estimate contract_revert while still ready → persistent (donation-brick path)", async () => {
    const chain = new FakeChain({
      phases: ["ready"], // stays ready across all re-reads
      estimates: [new Error("execution reverted: arb tolerance"), new Error("execution reverted"), new Error("execution reverted")],
      classify: () => "contract_revert",
    });
    const { keeper, metrics } = build(chain, { maxAttempts: 3 });
    const r = await keeper.onReady(CURVE);
    expect(r.status).toBe("failed_persistent");
    expect(chain.sendCount).toBe(0); // never got past estimate
    expect(metrics.snapshot().failedPersistentTotal).toBe(1);
  });
});

describe("fallback sweep", () => {
  test("scans the ready set, graduates each, and records the sweep", async () => {
    const chain = new FakeChain({ phases: ["ready"], receipts: [{ status: "success" }, { status: "success" }] });
    const db = new FakeDb([
      { token: "0xt1", curve: "0xc1" },
      { token: "0xt2", curve: "0xc2" },
    ] as never);
    const { keeper, metrics } = build(chain, { db });
    const results = await keeper.sweep();
    expect(results.map((r) => r.status)).toEqual(["graduated", "graduated"]);
    expect(metrics.snapshot().lastSweepScanned).toBe(2);
    expect(metrics.snapshot().sweepsTotal).toBe(1);
  });
});
