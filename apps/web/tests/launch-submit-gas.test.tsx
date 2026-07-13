import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BaseError } from "viem";

import { canonicalizeMetadata, metadataHash } from "@robbed/shared";

/**
 * Regression: MetaMask "Network fee unavailable" on the Robinhood Orbit LAUNCH tx.
 *
 * `Router.createToken` is a VALID tx — the node's `eth_estimateGas` succeeds — but
 * the wallet's OWN client gas estimation trips over the ArbOS L1-data-fee gas
 * component and shows "Network fee unavailable" (the same quirk fixed for trades).
 * The fix pre-estimates gas node-side via `publicClient.estimateContractGas` and
 * passes an explicit `gas` limit (`estimate * 2`, capped at a create-sized 8M
 * ceiling) to `writeContractAsync`; per viem, passing a gas limit SKIPS the
 * wallet's estimation. A genuine revert during estimation must NOT be swallowed —
 * it surfaces through `humanizeError` (decoded reason).
 */

const ACCOUNT = "0x00000000000000000000000000000000000000ee" as const;
const ROUTER = "0x00000000000000000000000000000000000000a1" as const;
const IMAGE_URL = "https://cdn.example/i.png";
const IMAGE_HASH = `0x${"11".repeat(32)}` as const;
const DEPLOY_FEE = 3n * 10n ** 15n;
const INITIAL_BUY = 5n * 10n ** 17n;

const m = vi.hoisted(() => ({
  estimateContractGas: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  writeContractAsync: vi.fn(),
  optimistic: {
    submit: vi.fn(),
    attachHash: vi.fn(),
    applyReceipt: vi.fn(),
    reject: vi.fn(),
    trades: [] as unknown[],
  },
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: ACCOUNT, isConnected: true }),
  usePublicClient: () => ({
    estimateContractGas: m.estimateContractGas,
    waitForTransactionReceipt: m.waitForTransactionReceipt,
  }),
  useWriteContract: () => ({ writeContractAsync: m.writeContractAsync }),
}));

vi.mock("@/entities/trade", () => ({
  useOptimisticTrades: () => m.optimistic,
}));

// Hermetic addresses (mirrors the trade gas test): passthrough requireAddress so
// no real 4663 codegen is needed in the unit env. Literals are inlined because
// the vi.mock factory is hoisted above module consts (they equal ROUTER above);
// test files are exempt from the address-literal lint.
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

import { buildMetadataDocument, useLaunch } from "@/features/launch-token";

// A server metadata response whose hash byte-matches what the client recomputes
// (§12.19) — otherwise `launch()` blocks at verify-failed and never signs.
function serverFor(name: string, ticker: string) {
  const doc = buildMetadataDocument({ name, ticker, imageUrl: IMAGE_URL, imageHash: IMAGE_HASH });
  return {
    metadataUri: "https://cdn.example/m.json",
    metadataHash: metadataHash(doc),
    canonicalJson: new TextDecoder("utf-8").decode(canonicalizeMetadata(doc)),
  };
}

const fakeImage = { size: 1000, type: "image/png", name: "i.png" } as unknown as File;

function launchOpts(over: Record<string, unknown> = {}): Parameters<typeof useLaunch>[0] {
  return {
    uploadImageFn: vi.fn(async () => ({
      imageUrl: IMAGE_URL,
      imageHash: IMAGE_HASH,
      width: 512,
      height: 512,
      bytes: 1000,
    })),
    postMetadataFn: vi.fn(async () => serverFor("Cash Cat", "CASHCAT")),
    fetchTokenFn: vi.fn(async () => ({ address: "0xabc" })),
    navigate: vi.fn(),
    ...over,
  };
}

function calls(fn: ReturnType<typeof vi.fn>) {
  return fn.mock.calls.map((c) => c[0]);
}

async function runLaunch(opts: Parameters<typeof useLaunch>[0]) {
  const { result } = renderHook(() => useLaunch(opts));
  await act(async () => {
    await result.current.uploadImage(fakeImage);
  });
  await act(async () => {
    await result.current.launch({
      name: "Cash Cat",
      ticker: "CASHCAT",
      initialBuyWei: INITIAL_BUY,
      minTokensOut: 1n,
      deployFeeWei: DEPLOY_FEE,
    });
  });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.writeContractAsync.mockResolvedValue("0xhash");
  // Receipt success but no logs → the flow ends after the write (no TokenCreated
  // to decode); irrelevant to the gas wiring under test.
  m.waitForTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 10n, logs: [] });
});
afterEach(cleanup);

describe("createToken carries an explicit pre-estimated gas limit (§ launch fix)", () => {
  it("estimates node-side (value = deployFee + initialBuy, account), writes gas = 2× estimate", async () => {
    m.estimateContractGas.mockResolvedValue(3_700_000n); // create() is heavy (~7.4M @2×)
    await runLaunch(launchOpts());

    // The node estimate ran for createToken with the total sent value + account,
    // so the ArbOS L1 component is included — the estimate the wallet can't do.
    const est = calls(m.estimateContractGas)[0];
    expect(est.functionName).toBe("createToken");
    expect(est.value).toBe(DEPLOY_FEE + INITIAL_BUY);
    expect(est.account).toBe(ACCOUNT);

    // The write carries the EXPLICIT gas limit → the wallet skips its own estimate.
    const write = calls(m.writeContractAsync)[0];
    expect(write.functionName).toBe("createToken");
    expect(write.value).toBe(DEPLOY_FEE + INITIAL_BUY);
    expect(write.gas).toBe(7_400_000n);
  });

  it("caps a pathological estimate at the 8M create ceiling", async () => {
    m.estimateContractGas.mockResolvedValue(5_000_000n); // 2× = 10M > 8M ceiling
    await runLaunch(launchOpts());
    expect(calls(m.writeContractAsync)[0].gas).toBe(8_000_000n);
  });
});

describe("a genuine estimate revert is surfaced, not swallowed", () => {
  it("estimateContractGas throwing → reason shown, tx NOT broadcast, optimistic row rejected", async () => {
    m.estimateContractGas.mockRejectedValue(
      new BaseError("execution reverted: CreatesPaused()"),
    );
    const result = await runLaunch(launchOpts());

    // The write NEVER happened — we didn't proceed past the revert.
    expect(m.writeContractAsync).not.toHaveBeenCalled();
    // The user sees WHY (mapped from the decoded shortMessage).
    expect(result.current.error).toBe("New launches are temporarily paused.");
    expect(result.current.step).toBe("error");
    // The optimistic row is rolled back (it never reached chain).
    expect(m.optimistic.reject).toHaveBeenCalledTimes(1);
    expect(m.optimistic.attachHash).not.toHaveBeenCalled();
  });
});
