/**
 * bot/farm heuristics suite (indexer.md, M2-13).
 * Drives the PURE `runFlowAnalysis` + per-heuristic classifiers — the same code
 * the flow job runs. Advisory ONLY: this suite asserts labels + organic ranges,
 * and that no export gates a trade/listing (there is no such code path).
 */
import { describe, expect, it } from "bun:test";
import {
  DEFAULT_FLOW_THRESHOLDS,
  classifyFunderClusters,
  isSniper,
  isProgrammatic,
  isWash,
  isArbExit,
  runFlowAnalysis,
  computePlatformClusterShare,
  maxTokenClusterShare,
  loadFlowThresholds,
  type FirstInboundRow,
  type FlowInput,
} from "../src/flags/heuristics";

const T = DEFAULT_FLOW_THRESHOLDS;
const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const FUNDER = "0x" + "f0".repeat(20);
const ROUTER = "0x" + "a1".repeat(20);
const MICRO = 100_000_000_000_000n; // 0.0001 ETH < 0.001 threshold

const emptyInput = (): FlowInput => ({
  firstInbound: [],
  firstBuys: [],
  programmatic: [],
  multiPoolExits: [],
  tradeAggs: [],
  clusterVol24h: [],
  holders: [],
});

// ── Heuristic 1: funder clustering → farm + cluster_id ──────────────────────

describe("funder clustering (heuristic 1)", () => {
  const funded = (count: number, ts = 1000): FirstInboundRow[] =>
    Array.from({ length: count }, (_, i) => ({
      address: addr(i + 1),
      funder: FUNDER,
      valueWei: MICRO,
      fundedAtSec: ts,
    }));

  it("20 micro-funded wallets from one funder in 24h → all clustered", () => {
    const map = classifyFunderClusters(funded(20), T);
    expect(map.size).toBe(20);
    for (const [, cid] of map) expect(cid).toBe(`funder:${FUNDER}`);
  });

  it("19 wallets → below threshold, no cluster", () => {
    expect(classifyFunderClusters(funded(19), T).size).toBe(0);
  });

  it("non-micro transfers are ignored even at fan-out ≥ 20", () => {
    const big = funded(20).map((r) => ({ ...r, valueWei: T.microTransferWei }));
    expect(classifyFunderClusters(big, T).size).toBe(0);
  });

  it("runFlowAnalysis marks each clustered wallet farm + cluster_id", () => {
    const input = { ...emptyInput(), firstInbound: funded(20) };
    const { addressFlags } = runFlowAnalysis(input, T, new Set());
    expect(addressFlags).toHaveLength(20);
    for (const af of addressFlags) {
      expect(af.flags).toContain("farm");
      expect(af.clusterId).toBe(`funder:${FUNDER}`);
    }
  });
});

// ── Heuristic 2: sniper timing boundary ─────────────────────────────────────

describe("sniper (heuristic 2)", () => {
  it("buy at t+59s (funded 59s prior) → sniper; t+61s → not", () => {
    expect(isSniper(1059, 1000, 1000, T)).toBe(true);
    expect(isSniper(1061, 1000, 1000, T)).toBe(false);
  });
  it("not funded → never a sniper", () => {
    expect(isSniper(1059, 1000, null, T)).toBe(false);
  });
  it("funded too long ago (> 1h before buy) → not a sniper", () => {
    expect(isSniper(1059, 1000, 1059 - 3600, T)).toBe(false);
  });
});

// ── Heuristic 3: contract-mediated execution + own-contract whitelist ───────

describe("programmatic (heuristic 3)", () => {
  const whitelist = new Set([ROUTER.toLowerCase()]);
  it("own Router mediating (executor==router) is NOT flagged", () => {
    expect(isProgrammatic(ROUTER, addr(7), whitelist)).toBe(false);
  });
  it("third-party executor != recipient IS flagged", () => {
    expect(isProgrammatic(addr(99), addr(7), whitelist)).toBe(true);
  });
  it("executor == recipient (direct EOA) is not flagged", () => {
    expect(isProgrammatic(addr(7), addr(7), whitelist)).toBe(false);
  });
  it("runFlowAnalysis never flags a whitelisted own-Router trade", () => {
    const input: FlowInput = {
      ...emptyInput(),
      programmatic: [
        { address: addr(7), executor: ROUTER, recipient: addr(7) }, // own router → skip
        { address: addr(8), executor: addr(99), recipient: addr(8) }, // 3rd party → flag
      ],
    };
    const { addressFlags } = runFlowAnalysis(input, T, whitelist);
    const byAddr = new Map(addressFlags.map((a) => [a.address, a.flags]));
    expect(byAddr.has(addr(7))).toBe(false);
    expect(byAddr.get(addr(8))).toContain("programmatic");
  });
});

// ── Heuristic 4: wash-loop excluded from organic volume ─────────────────────

describe("wash-loop (heuristic 4)", () => {
  it("round-trip netting ≈ fees is wash; a one-way buy is not", () => {
    expect(isWash({ buyEthWei: 100n, sellEthWei: 99n, feeWei: 1n }, T)).toBe(true);
    expect(isWash({ buyEthWei: 100n, sellEthWei: 0n, feeWei: 1n }, T)).toBe(false);
    expect(isWash({ buyEthWei: 100n, sellEthWei: 50n, feeWei: 1n }, T)).toBe(false);
  });

  it("wash-flagged volume is EXCLUDED from organic volume", () => {
    const token = addr(1000);
    const washer = addr(1);
    const organic = addr(2);
    const input: FlowInput = {
      ...emptyInput(),
      tradeAggs: [
        { token, address: washer, buyEthWei: 100n, sellEthWei: 99n, feeWei: 1n }, // wash
        { token, address: organic, buyEthWei: 50n, sellEthWei: 0n, feeWei: 1n }, // organic
      ],
    };
    const { addressFlags, tokenStats } = runFlowAnalysis(input, T, new Set());
    expect(addressFlags.find((a) => a.address === washer)?.flags).toContain("wash");
    // organic volume = organic(50) / total(199+50=249) → wash 199 excluded.
    const stat = tokenStats.find((s) => s.token === token)!;
    expect(stat.organicVolumePct).toBeCloseTo((50 / 249) * 100, 2);
  });
});

// ── Heuristic 5: same-second multi-pool exits ───────────────────────────────

describe("arb/exit (heuristic 5)", () => {
  it("≥3 pools in one block → arb_exit; 2 → not", () => {
    expect(isArbExit(3, T)).toBe(true);
    expect(isArbExit(2, T)).toBe(false);
  });
  it("runFlowAnalysis flags the multi-pool exiter arb_exit", () => {
    const input: FlowInput = {
      ...emptyInput(),
      multiPoolExits: [{ address: addr(5), block: 10, poolCount: 3 }],
    };
    const { addressFlags } = runFlowAnalysis(input, T, new Set());
    expect(addressFlags.find((a) => a.address === addr(5))?.flags).toContain("arb_exit");
  });
});

// ── Organic-holder % as a RANGE (no false precision) ───────────────────

describe("organic-holder % is a range", () => {
  it("low counts every flag; high counts only strong flags (farm/wash)", () => {
    const token = addr(2000);
    const farmer = addr(1); // strong flag (farm) via cluster
    const sniper = addr(2); // weak flag
    const clean = addr(3);
    const input: FlowInput = {
      ...emptyInput(),
      firstInbound: Array.from({ length: 20 }, (_, i) => ({
        address: i === 0 ? farmer : addr(100 + i),
        funder: FUNDER,
        valueWei: MICRO,
        fundedAtSec: 1000,
      })),
      firstBuys: [{ token, trader: sniper, firstBuyAtSec: 1050, tokenCreatedAtSec: 1000 }],
      holders: [
        { token, holder: farmer },
        { token, holder: sniper },
        { token, holder: clean },
      ],
    };
    // sniper must be funded to qualify — add its funding.
    input.firstInbound.push({ address: sniper, funder: addr(555), valueWei: MICRO, fundedAtSec: 1000 });
    const { tokenStats } = runFlowAnalysis(input, T, new Set());
    const stat = tokenStats.find((s) => s.token === token)!;
    // low: only `clean` organic → 1/3; high: `clean` + `sniper` (weak) → 2/3.
    expect(stat.organicHolderPctLow).toBeCloseTo((1 / 3) * 100, 2);
    expect(stat.organicHolderPctHigh).toBeCloseTo((2 / 3) * 100, 2);
    expect(stat.organicHolderPctLow).toBeLessThan(stat.organicHolderPctHigh);
  });

  it("no holders/volume → fully organic (100%), no false precision", () => {
    const { tokenStats } = runFlowAnalysis({ ...emptyInput(), holders: [{ token: addr(9), holder: addr(1) }] }, T, new Set());
    const stat = tokenStats.find((s) => s.token === addr(9))!;
    expect(stat.organicHolderPctLow).toBe(100);
    expect(stat.organicVolumePct).toBe(100);
  });
});

// ── Cluster-share aggregates (feed gate-7 M2-12) ────────────────────────────

describe("funder-cluster vol share", () => {
  it("per-token + platform share reflect the clustered volume", () => {
    const token = addr(3000);
    const wallets = Array.from({ length: 20 }, (_, i) => addr(i + 1));
    const input: FlowInput = {
      ...emptyInput(),
      firstInbound: wallets.map((a) => ({ address: a, funder: FUNDER, valueWei: MICRO, fundedAtSec: 1000 })),
      clusterVol24h: [
        ...wallets.map((a) => ({ token, address: a, vol24hWei: 10n })), // clustered: 200
        { token, address: addr(9999), vol24hWei: 200n }, // organic: 200
      ],
    };
    const result = runFlowAnalysis(input, T, new Set());
    // token max cluster share = 200 / 400 = 50%.
    expect(maxTokenClusterShare(result)).toBeCloseTo(50, 2);
    expect(computePlatformClusterShare(input, result)).toBeCloseTo(50, 2);
  });
});

// ── Config, not literals ────────────────────────────────────────────────────

describe("thresholds are config (defaults, env-overridable)", () => {
  it("defaults match v1", () => {
    const t = loadFlowThresholds({});
    expect(t.funderMinWallets).toBe(20);
    expect(t.microTransferWei).toBe(1_000_000_000_000_000n);
    expect(t.sniperWindowSec).toBe(60);
    expect(t.multiPoolExitMin).toBe(3);
  });
  it("env overrides the funder fan-out", () => {
    expect(loadFlowThresholds({ FLOW_FUNDER_MIN_WALLETS: "5" }).funderMinWallets).toBe(5);
  });
});
