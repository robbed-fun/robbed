"use client";

import { launchTokenAbi, routerAbi } from "@robbed/shared/abi";
import type { TokenDetail } from "@robbed/shared";
import { useCallback, useState } from "react";
import { maxUint256, type Address } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";

import { useOptimisticTradesContext } from "@/entities/trade";
import {
  type CurveVenue,
  type TradeSide,
  applySlippageFloor,
  buildV3SwapRequest,
  computeDeadline,
  venueForStatus,
} from "@/entities/curve";
import { ROBBED, requireAddress } from "@/shared/config/addresses";
import { UNISWAP_V3 } from "@robbed/shared";

/**
 * Trade submission → optimistic lifecycle wiring for BOTH venues (§4, §5.2). The
 * INVISIBLE VENUE SWITCH is honoured here: the engine is chosen by the indexed
 * `status` (never a user choice) —
 *   curve/graduating → Router.buy/sell (curve, `routerAbi`)
 *   graduated        → Uniswap V3 SwapRouter02 (`swapRouter02Abi`, via the shared
 *                      `buildV3SwapRequest` builder)
 * — while the optimistic soft-confirmed lifecycle (submit → attach-hash →
 * receipt) is IDENTICAL across the seam, so the trade feed badges the same way
 * pre- and post-graduation.
 *
 * SELL IS NEVER GATED (§6.5/§12.25): this hook reads NO pause flag on any path,
 * for either venue; the Buy-tab pause gate lives entirely in the UI's
 * `usePauseBuys`, never here. Post-graduation has no pause authority at all (§6.5).
 *
 * DECISIONS (robbed-frontend):
 * - Curve sells use approve-then-sell when the router allowance is short;
 *   `sellWithPermit` (one signature) is a deferred EIP-2612 optimization.
 * - V3 sells approve the SwapRouter02 (not the robbed router) then swap token→ETH
 *   via `multicall([exactInputSingle→router, unwrapWETH9(minEthOut, user)])` — the
 *   native-ETH leg the shared periphery subset exists for (§12.28). V3 buys send
 *   native ETH as `value` (SwapRouter02 wraps it); no allowance needed.
 * - The DEADLINE is recomputed HERE from `Date.now()` (not from the quote) so a
 *   stale on-screen quote can never ship an expired deadline (web.md decide-self).
 */

export interface SubmitArgs {
  side: TradeSide;
  /** ETH-in (buy) or token-in (sell), wei. */
  amountWei: bigint;
  /** Expected output from the ACTIVE venue's quote — tokens (buy) / ETH (sell), wei. */
  expectedOut: bigint;
  slippageBps: number;
}

export function useTradeSubmit(token: TokenDetail): {
  submit: (args: SubmitArgs) => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
} {
  const { address: account } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const optimistic = useOptimisticTradesContext();
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const venue: CurveVenue = venueForStatus(token.status);

  const submit = useCallback(
    async ({ side, amountWei, expectedOut, slippageBps }: SubmitArgs) => {
      setError(null);
      if (!account) {
        setError("Connect a wallet to trade.");
        return;
      }

      const tokenAddr = token.address as Address;
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      // DEADLINE recomputed HERE (not from the quote) so a stale on-screen quote
      // can never ship an expired deadline (web.md decide-yourself).
      const deadline = computeDeadline();
      const minOut = applySlippageFloor(expectedOut, slippageBps);

      // Immediate optimistic row (§4 rule 1). Values are our estimate until the
      // indexed WS trade reconciles them.
      optimistic.submit({
        id,
        sender: account,
        token: token.address,
        isBuy: side === "buy",
        ethAmount: (side === "buy" ? amountWei : expectedOut).toString(),
        tokenAmount: (side === "buy" ? expectedOut : amountWei).toString(),
        priceEth: token.priceEth ?? undefined,
      });

      setSubmitting(true);
      try {
        const venueArgs: VenueSubmitArgs = {
          writeContractAsync,
          publicClient,
          side,
          token: tokenAddr,
          account,
          amountWei,
          minOut,
          deadline,
        };
        const hash =
          venue === "v3" ? await submitV3(venueArgs) : await submitCurve(venueArgs);

        optimistic.attachHash(id, hash);

        const receipt = await publicClient?.waitForTransactionReceipt({ hash });
        optimistic.applyReceipt(
          id,
          receipt?.status === "success" ? "success" : "reverted",
          receipt?.blockNumber,
        );
      } catch (e) {
        // In-wallet rejection / broadcast failure → remove the optimistic row
        // (it never reached chain) and surface the reason (§4).
        optimistic.reject(id);
        setError(humanizeError(e));
      } finally {
        setSubmitting(false);
      }
    },
    [account, optimistic, publicClient, token.address, token.priceEth, venue, writeContractAsync],
  );

  return { submit, isSubmitting, error };
}

type WriteAsync = ReturnType<typeof useWriteContract>["writeContractAsync"];
type PublicClient = ReturnType<typeof usePublicClient>;

interface VenueSubmitArgs {
  writeContractAsync: WriteAsync;
  publicClient: PublicClient;
  side: TradeSide;
  token: Address;
  account: Address;
  amountWei: bigint;
  minOut: bigint;
  deadline: bigint;
}

/** Curve venue: Router.buy (payable) / Router.sell (approve-then-sell). */
async function submitCurve(a: VenueSubmitArgs): Promise<`0x${string}`> {
  const router = requireAddress(ROBBED.router, "router");
  if (a.side === "buy") {
    return a.writeContractAsync({
      address: router,
      abi: routerAbi,
      functionName: "buy",
      args: [a.token, a.account, a.minOut, a.deadline],
      value: a.amountWei,
    });
  }
  await ensureAllowance({
    publicClient: a.publicClient,
    writeContractAsync: a.writeContractAsync,
    token: a.token,
    owner: a.account,
    spender: router,
    amount: a.amountWei,
  });
  return a.writeContractAsync({
    address: router,
    abi: routerAbi,
    functionName: "sell",
    args: [a.token, a.amountWei, a.account, a.minOut, a.deadline],
  });
}

/** V3 venue: SwapRouter02 exact-input, deadline-wrapped in multicall (§12.28). */
async function submitV3(a: VenueSubmitArgs): Promise<`0x${string}`> {
  if (a.side === "sell") {
    // Native-ETH sell needs the token approved to the SwapRouter02.
    await ensureAllowance({
      publicClient: a.publicClient,
      writeContractAsync: a.writeContractAsync,
      token: a.token,
      owner: a.account,
      spender: UNISWAP_V3.swapRouter02 as Address,
      amount: a.amountWei,
    });
  }
  const req = buildV3SwapRequest({
    side: a.side,
    token: a.token,
    account: a.account,
    amountWei: a.amountWei,
    minOut: a.minOut,
    deadline: a.deadline,
  });
  return a.writeContractAsync({
    address: req.address,
    abi: req.abi,
    functionName: req.functionName,
    args: req.args,
    value: req.value,
  });
}

async function ensureAllowance(args: {
  publicClient: PublicClient;
  writeContractAsync: WriteAsync;
  token: Address;
  owner: Address;
  spender: Address;
  amount: bigint;
}): Promise<void> {
  const { publicClient, writeContractAsync, token, owner, spender, amount } = args;
  if (!publicClient) return;
  const allowance = (await publicClient.readContract({
    address: token,
    abi: launchTokenAbi,
    functionName: "allowance",
    args: [owner, spender],
  })) as bigint;
  if (allowance >= amount) return;
  const hash = await writeContractAsync({
    address: token,
    abi: launchTokenAbi,
    functionName: "approve",
    args: [spender, maxUint256],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

function humanizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/user rejected|denied|rejected the request/i.test(msg)) {
    return "Transaction rejected in wallet.";
  }
  if (/deadline|expired|transaction too old/i.test(msg))
    return "Trade deadline expired — refresh the quote.";
  if (/slippage|Too little received|Too much requested/i.test(msg))
    return "Price moved past your slippage — retry.";
  return msg.length > 160 ? `${msg.slice(0, 157)}…` : msg;
}
