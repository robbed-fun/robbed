import { quoterV2Abi, swapRouter02Abi } from "@robbed/shared/abi";
import { UNISWAP_V3, WETH_ADDRESS } from "@robbed/shared";
import { encodeFunctionData, numberToHex, type Address, type Hex } from "viem";

import type { TradeSide } from "../model/quote";

/**
 * Pure builders for the post-graduation Uniswap V3 venue (§5.2 invisible venue
 * switch, M3-5). Kept side-effect-free so the routing wiring — which contract,
 * which fee tier, how the native-ETH sell leg is composed — is unit-testable
 * without a wallet (tests/v3-swap.test.ts).
 *
 * The ABIs are the SHARED, pinned Uniswap periphery artifacts (`quoterV2Abi` /
 * `swapRouter02Abi` from `@robbed/shared/abi`, §12.28) — never hand-written
 * (CLAUDE.md anti-drift rule). Addresses are the shared `UNISWAP_V3` registry and
 * the shared `WETH_ADDRESS`; no address literal is inlined here.
 *
 * DECISIONS (hoodpad-frontend; basis: Uniswap swap-router-contracts docs, verified
 * 2026-07-10):
 * - The widget is AMOUNT-IN driven ("You pay X") for both legs, so both quote and
 *   execute use the EXACT-INPUT primitives (`quoteExactInputSingle` /
 *   `exactInputSingle`). `quoteExactOutputSingle` / `exactOutputSingle` +
 *   `refundETH` are the exact-output mirror and are unused by this input-driven
 *   UX — no unspent-ETH refund can arise from an exact-input buy.
 * - Fee tier is the graduation pool's 1% tier (`10000`), per §12.28 (deploy
 *   asserts `feeAmountTickSpacing(10000) == 200`).
 * - Native-ETH sell: `multicall(deadline, [exactInputSingle(recipient=router-self),
 *   unwrapWETH9(minEthOut, user)])`. WETH is swept to the router (ADDRESS_THIS
 *   sentinel) and `unwrapWETH9` enforces the slippage floor while forwarding native
 *   ETH to the user, so the inner swap's `amountOutMinimum` is 0.
 * - Native-ETH buy: `multicall(deadline, [exactInputSingle(recipient=user)])` with
 *   `value = ethIn`; SwapRouter02 wraps the sent ETH. The deadline is applied via
 *   the `multicall(uint256 deadline, bytes[])` overload on EVERY trade (§5.2).
 */

/** Graduation pool fee tier — 1% (§12.28). */
export const V3_FEE_TIER = 10000;

/**
 * SwapRouter02 recipient sentinel `ADDRESS_THIS` (== `address(2)`): "keep the
 * output in the router" so a follow-up `unwrapWETH9` can convert WETH→native ETH
 * (Uniswap swap-router-contracts `libraries/Constants.sol`). NOT a contract or
 * market address — a protocol sentinel; COMPUTED (never a 40-hex literal) so the
 * address-literal lint stays clean. Resolves to 0x000…002.
 */
export const V3_ROUTER_ADDRESS_THIS = numberToHex(2, { size: 20 }) as Address;

/** No price limit — take the pool's current price (0 = unbounded). */
const NO_PRICE_LIMIT = 0n;

/** tokenIn/tokenOut for a side: buy = WETH→token, sell = token→WETH. */
export function resolveV3Direction(
  side: TradeSide,
  token: Address,
): { tokenIn: Address; tokenOut: Address } {
  return side === "buy"
    ? { tokenIn: WETH_ADDRESS, tokenOut: token }
    : { tokenIn: token, tokenOut: WETH_ADDRESS };
}

export interface V3QuoteRequest {
  address: Address;
  abi: typeof quoterV2Abi;
  functionName: "quoteExactInputSingle";
  args: readonly [
    {
      tokenIn: Address;
      tokenOut: Address;
      amountIn: bigint;
      fee: number;
      sqrtPriceLimitX96: bigint;
    },
  ];
}

/**
 * QuoterV2 exact-input request. `quoteExactInputSingle` is a REVERT-QUOTER
 * (nonpayable) — the caller MUST run it via `simulateContract` /
 * `useSimulateContract`, never `readContract` (§12.28). `data.result[0]` is
 * `amountOut`.
 */
export function buildV3QuoteRequest(args: {
  side: TradeSide;
  token: Address;
  amountWei: bigint;
}): V3QuoteRequest {
  const { tokenIn, tokenOut } = resolveV3Direction(args.side, args.token);
  return {
    address: UNISWAP_V3.quoterV2 as Address,
    abi: quoterV2Abi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn,
        tokenOut,
        amountIn: args.amountWei,
        fee: V3_FEE_TIER,
        sqrtPriceLimitX96: NO_PRICE_LIMIT,
      },
    ],
  };
}

export interface V3SwapRequest {
  address: Address;
  abi: typeof swapRouter02Abi;
  functionName: "multicall";
  args: readonly [bigint, readonly Hex[]];
  /** msg.value — the native ETH sent on a buy; 0n on a sell. */
  value: bigint;
}

/**
 * SwapRouter02 exact-input execution, wrapped in `multicall(deadline, …)` so the
 * deadline is enforced on every trade (§5.2). `token` is the LaunchToken address,
 * `account` the recipient, `minOut` the slippage floor (tokens on a buy, ETH on a
 * sell), `amountWei` the ETH-in (buy) / token-in (sell).
 */
export function buildV3SwapRequest(args: {
  side: TradeSide;
  token: Address;
  account: Address;
  amountWei: bigint;
  minOut: bigint;
  deadline: bigint;
}): V3SwapRequest {
  const { side, token, account, amountWei, minOut, deadline } = args;
  const swapRouter = UNISWAP_V3.swapRouter02 as Address;
  const { tokenIn, tokenOut } = resolveV3Direction(side, token);

  if (side === "buy") {
    // WETH→token, output straight to the user; SwapRouter02 wraps msg.value.
    const swap = encodeFunctionData({
      abi: swapRouter02Abi,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn,
          tokenOut,
          fee: V3_FEE_TIER,
          recipient: account,
          amountIn: amountWei,
          amountOutMinimum: minOut,
          sqrtPriceLimitX96: NO_PRICE_LIMIT,
        },
      ],
    });
    return {
      address: swapRouter,
      abi: swapRouter02Abi,
      functionName: "multicall",
      args: [deadline, [swap]],
      value: amountWei,
    };
  }

  // Sell: token→WETH into the router (ADDRESS_THIS), then unwrap to native ETH
  // with the slippage floor enforced by unwrapWETH9 (inner swap min = 0).
  const swap = encodeFunctionData({
    abi: swapRouter02Abi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn,
        tokenOut,
        fee: V3_FEE_TIER,
        recipient: V3_ROUTER_ADDRESS_THIS,
        amountIn: amountWei,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: NO_PRICE_LIMIT,
      },
    ],
  });
  const unwrap = encodeFunctionData({
    abi: swapRouter02Abi,
    functionName: "unwrapWETH9",
    args: [minOut, account],
  });
  return {
    address: swapRouter,
    abi: swapRouter02Abi,
    functionName: "multicall",
    args: [deadline, [swap, unwrap]],
    value: 0n,
  };
}
