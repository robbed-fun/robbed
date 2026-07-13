import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BaseError } from "viem";

import { tokenDetail } from "./fixtures";

/**
 * Regression: MetaMask "Network fee unavailable" on Robinhood Orbit trades.
 *
 * The Router buy/sell txs are VALID — the node's `eth_estimateGas` succeeds — but
 * the wallet's OWN client gas estimation trips over the ArbOS L1-data-fee gas
 * component and shows "Network fee unavailable". The fix pre-estimates gas node-side
 * via `publicClient.estimateContractGas` and passes an explicit `gas` limit
 * (`estimate * 2`, capped) to `writeContractAsync`; per viem, passing a gas limit
 * SKIPS the wallet's estimation. A genuine revert during estimation must NOT be
 * swallowed — it surfaces through `humanizeError`.
 *
 * These tests prove: (1) every write path carries an explicit `gas = 2×` the node
 * estimate; (2) the ceiling caps a pathological estimate; (3) the approve leg of a
 * sell is treated the same; (4) an estimate revert surfaces the reason and never
 * broadcasts the tx.
 */

const ACCOUNT = "0x00000000000000000000000000000000000000ee" as const;

const m = vi.hoisted(() => ({
  estimateContractGas: vi.fn(),
  readContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  writeContractAsync: vi.fn(),
  optimistic: {
    submit: vi.fn(),
    attachHash: vi.fn(),
    applyReceipt: vi.fn(),
    reject: vi.fn(),
  },
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: ACCOUNT, isConnected: true }),
  usePublicClient: () => ({
    estimateContractGas: m.estimateContractGas,
    readContract: m.readContract,
    waitForTransactionReceipt: m.waitForTransactionReceipt,
    // Deadlines derive from CHAIN time (computeChainDeadline); model it so the
    // gas path here runs against a realistic client, not the browser-clock fallback.
    getBlock: async () => ({ timestamp: 2_000_000_000n }),
  }),
  useWriteContract: () => ({ writeContractAsync: m.writeContractAsync }),
}));

vi.mock("@/entities/trade", () => ({
  useOptimisticTradesContext: () => m.optimistic,
}));

// Hermetic addresses (avoids the real requireAddress throwing when no 4663
// deployment is codegen'd in the unit env). Passthrough requireAddress.
vi.mock("@/shared/config/addresses", () => ({
  ROBBED: { router: "0x00000000000000000000000000000000000000a1" },
  V3: {
    swapRouter02: "0x00000000000000000000000000000000000000a2",
    quoterV2: "0x00000000000000000000000000000000000000a3",
    factory: "0x00000000000000000000000000000000000000a4",
    positionManager: "0x00000000000000000000000000000000000000a5",
  },
  WETH: "0x00000000000000000000000000000000000000a6",
  requireAddress: (addr: string) => addr,
  isPlaceholder: () => false,
}));

import { useTradeSubmit } from "@/widgets/trade-widget/model/use-trade-submit";

const HALF_ETH = 5n * 10n ** 17n;

function calls(fn: ReturnType<typeof vi.fn>) {
  return fn.mock.calls.map((c) => c[0]);
}

beforeEach(() => {
  vi.resetAllMocks();
  m.writeContractAsync.mockResolvedValue("0xhash");
  m.waitForTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 10n });
});
afterEach(cleanup);

describe("curve BUY carries an explicit pre-estimated gas limit (§ fix)", () => {
  it("estimates node-side, then writes buy with gas = 2× the estimate", async () => {
    m.estimateContractGas.mockResolvedValue(233_000n);
    const { result } = renderHook(() => useTradeSubmit(tokenDetail({ status: "curve" })));

    await act(async () => {
      await result.current.submit({
        side: "buy",
        amountWei: HALF_ETH,
        expectedOut: 1_000_000n,
        slippageBps: 200,
      });
    });

    // The node estimate ran for the buy, with the sent value + account (so the
    // ArbOS L1 component is included) — this is the estimate the wallet can't do.
    const est = calls(m.estimateContractGas)[0];
    expect(est.functionName).toBe("buy");
    expect(est.value).toBe(HALF_ETH);
    expect(est.account).toBe(ACCOUNT);

    // The write carries the EXPLICIT gas limit → the wallet skips its own estimate.
    const write = calls(m.writeContractAsync)[0];
    expect(write.functionName).toBe("buy");
    expect(write.value).toBe(HALF_ETH);
    expect(write.gas).toBe(466_000n);

    // The optimistic lifecycle is untouched by the gas change.
    expect(m.optimistic.submit).toHaveBeenCalledTimes(1);
    expect(m.optimistic.attachHash).toHaveBeenCalledWith(expect.any(String), "0xhash");
    expect(m.optimistic.applyReceipt).toHaveBeenCalledWith(expect.any(String), "success", 10n);
    expect(result.current.error).toBeNull();
  });

  it("caps a pathological estimate at the ceiling (never an absurd limit)", async () => {
    m.estimateContractGas.mockResolvedValue(9_000_000n); // 2× = 18M > 5M ceiling
    const { result } = renderHook(() => useTradeSubmit(tokenDetail({ status: "curve" })));
    await act(async () => {
      await result.current.submit({
        side: "buy",
        amountWei: HALF_ETH,
        expectedOut: 1_000_000n,
        slippageBps: 200,
      });
    });
    expect(calls(m.writeContractAsync)[0].gas).toBe(5_000_000n);
  });
});

describe("curve SELL — approve AND sell both carry an explicit gas limit", () => {
  it("insufficient allowance → approve(gas) then sell(gas), both 2× estimate", async () => {
    m.readContract.mockResolvedValue(0n); // allowance short → approve leg runs
    m.estimateContractGas.mockResolvedValue(120_000n);
    const { result } = renderHook(() => useTradeSubmit(tokenDetail({ status: "curve" })));

    await act(async () => {
      await result.current.submit({
        side: "sell",
        amountWei: 1000n * 10n ** 18n,
        expectedOut: 3n * 10n ** 16n,
        slippageBps: 200,
      });
    });

    // Both legs are estimated node-side, in order (approve BEFORE the sell so the
    // sell estimate doesn't revert on transferFrom).
    expect(calls(m.estimateContractGas).map((c) => c.functionName)).toEqual(["approve", "sell"]);
    const writes = calls(m.writeContractAsync);
    expect(writes[0].functionName).toBe("approve");
    expect(writes[0].gas).toBe(240_000n);
    expect(writes[1].functionName).toBe("sell");
    expect(writes[1].gas).toBe(240_000n);
    expect(result.current.error).toBeNull();
  });
});

describe("graduated V3 BUY carries an explicit gas limit (invisible venue switch)", () => {
  it("estimates the multicall node-side, then writes with gas = 2× estimate", async () => {
    m.estimateContractGas.mockResolvedValue(300_000n);
    const { result } = renderHook(() =>
      useTradeSubmit(tokenDetail({ status: "graduated", graduated: true })),
    );

    await act(async () => {
      await result.current.submit({
        side: "buy",
        amountWei: HALF_ETH,
        expectedOut: 4200n,
        slippageBps: 200,
      });
    });

    const est = calls(m.estimateContractGas)[0];
    expect(est.functionName).toBe("multicall"); // SwapRouter02 deadline-wrapped
    expect(est.value).toBe(HALF_ETH); // native ETH in
    const write = calls(m.writeContractAsync)[0];
    expect(write.functionName).toBe("multicall");
    expect(write.gas).toBe(600_000n);
  });
});

describe("a genuine estimate revert is surfaced, not swallowed", () => {
  it("estimateContractGas throwing → reason shown, tx NOT broadcast, row rejected", async () => {
    // A viem revert (BaseError) whose shortMessage is the decoded reason.
    m.estimateContractGas.mockRejectedValue(new BaseError("Price slippage: too little received"));
    const { result } = renderHook(() => useTradeSubmit(tokenDetail({ status: "curve" })));

    await act(async () => {
      await result.current.submit({
        side: "buy",
        amountWei: HALF_ETH,
        expectedOut: 1_000_000n,
        slippageBps: 200,
      });
    });

    // The write NEVER happened — we didn't blindly proceed past the revert.
    expect(m.writeContractAsync).not.toHaveBeenCalled();
    // The user sees WHY (mapped from the shortMessage), not MetaMask's opaque copy.
    expect(result.current.error).toBe("Price moved past your slippage — retry.");
    // The optimistic row is rolled back (it never reached chain).
    expect(m.optimistic.reject).toHaveBeenCalledTimes(1);
    expect(m.optimistic.attachHash).not.toHaveBeenCalled();
  });
});
