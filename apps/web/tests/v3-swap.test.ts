import { describe, expect, it } from "vitest";
import { decodeFunctionData, type Address, type Hex } from "viem";

import { UNISWAP_V3, WETH_ADDRESS } from "@robbed/shared";
import { swapRouter02Abi } from "@robbed/shared/abi";
import {
  V3_FEE_TIER,
  V3_ROUTER_ADDRESS_THIS,
  buildV3QuoteRequest,
  buildV3SwapRequest,
  resolveV3Direction,
} from "@/entities/curve";

/**
 * Post-graduation Uniswap V3 routing (invisible venue switch, M3-5). Proves
 * the inline routing targets the SHARED periphery (QuoterV2 / SwapRouter02)
 * on the 1% tier, previews via the REVERT-quoter surface, and composes the
 * native-ETH sell via multicall(exactInputSingle → unwrapWETH9). No ABI is
 * hand-written — the builders bind the shared `swapRouter02Abi` / `quoterV2Abi`.
 */

const TOKEN = "0x00000000000000000000000000000000000000c0" as Address;
const ACCOUNT = "0x00000000000000000000000000000000000000ee" as Address;
const lc = (a: string) => a.toLowerCase();

describe("V3 direction + fee tier", () => {
  it("buy = WETH→token, sell = token→WETH, fee tier is the 1% pool", () => {
    expect(V3_FEE_TIER).toBe(10000);
    expect(resolveV3Direction("buy", TOKEN)).toEqual({ tokenIn: WETH_ADDRESS, tokenOut: TOKEN });
    expect(resolveV3Direction("sell", TOKEN)).toEqual({ tokenIn: TOKEN, tokenOut: WETH_ADDRESS });
  });
});

describe("QuoterV2 preview request (revert-quoter — simulate, not read)", () => {
  it("targets UNISWAP_V3.quoterV2 with the fee-10000 exact-input params", () => {
    const q = buildV3QuoteRequest({ side: "buy", token: TOKEN, amountWei: 5n * 10n ** 17n });
    expect(lc(q.address)).toBe(lc(UNISWAP_V3.quoterV2));
    expect(q.functionName).toBe("quoteExactInputSingle");
    const p = q.args[0];
    expect(lc(p.tokenIn)).toBe(lc(WETH_ADDRESS));
    expect(lc(p.tokenOut)).toBe(lc(TOKEN));
    expect(p.amountIn).toBe(5n * 10n ** 17n);
    expect(p.fee).toBe(10000);
    expect(p.sqrtPriceLimitX96).toBe(0n);
  });
});

describe("SwapRouter02 execution — buy (native ETH in)", () => {
  it("multicall(deadline,[exactInputSingle→user]) with value = ethIn", () => {
    const amt = 3n * 10n ** 17n;
    const req = buildV3SwapRequest({
      side: "buy",
      token: TOKEN,
      account: ACCOUNT,
      amountWei: amt,
      minOut: 111n,
      deadline: 1_800_000_000n,
    });
    expect(lc(req.address)).toBe(lc(UNISWAP_V3.swapRouter02));
    expect(req.functionName).toBe("multicall");
    expect(req.args[0]).toBe(1_800_000_000n);
    expect(req.value).toBe(amt); // native ETH sent; SwapRouter02 wraps it
    const calls = req.args[1] as readonly Hex[];
    expect(calls).toHaveLength(1);

    const inner = decodeFunctionData({ abi: swapRouter02Abi, data: calls[0]! });
    expect(inner.functionName).toBe("exactInputSingle");
    const p = (inner.args as readonly any[])[0];
    expect(lc(p.tokenIn)).toBe(lc(WETH_ADDRESS));
    expect(lc(p.tokenOut)).toBe(lc(TOKEN));
    expect(lc(p.recipient)).toBe(lc(ACCOUNT)); // output straight to the buyer
    expect(p.fee).toBe(10000);
    expect(p.amountIn).toBe(amt);
    expect(p.amountOutMinimum).toBe(111n); // 2% floor enforced on the swap
  });
});

describe("SwapRouter02 execution — sell (token → native ETH via unwrapWETH9)", () => {
  it("multicall(deadline,[exactInputSingle→router, unwrapWETH9(minEthOut,user)])", () => {
    const amt = 1_000n * 10n ** 18n; // tokens in
    const minEth = 42n * 10n ** 15n;
    const req = buildV3SwapRequest({
      side: "sell",
      token: TOKEN,
      account: ACCOUNT,
      amountWei: amt,
      minOut: minEth,
      deadline: 1_800_000_000n,
    });
    expect(lc(req.address)).toBe(lc(UNISWAP_V3.swapRouter02));
    expect(req.functionName).toBe("multicall");
    expect(req.value).toBe(0n); // no native ETH sent on a sell
    const calls = req.args[1] as readonly Hex[];
    expect(calls).toHaveLength(2);

    const swap = decodeFunctionData({ abi: swapRouter02Abi, data: calls[0]! });
    expect(swap.functionName).toBe("exactInputSingle");
    const p = (swap.args as readonly any[])[0];
    expect(lc(p.tokenIn)).toBe(lc(TOKEN));
    expect(lc(p.tokenOut)).toBe(lc(WETH_ADDRESS));
    // WETH swept to the router (ADDRESS_THIS) so the follow-up call can unwrap it.
    expect(lc(p.recipient)).toBe(lc(V3_ROUTER_ADDRESS_THIS));
    expect(p.amountIn).toBe(amt);
    // Slippage is enforced by unwrapWETH9, so the inner swap min is 0.
    expect(p.amountOutMinimum).toBe(0n);

    const unwrap = decodeFunctionData({ abi: swapRouter02Abi, data: calls[1]! });
    expect(unwrap.functionName).toBe("unwrapWETH9");
    const [amountMin, recipient] = unwrap.args as readonly any[];
    expect(amountMin).toBe(minEth); // the 2% ETH floor
    expect(lc(recipient)).toBe(lc(ACCOUNT)); // native ETH forwarded to the seller
  });
});
