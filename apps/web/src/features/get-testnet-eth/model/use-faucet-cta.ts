"use client";

import { useState } from "react";
import { useAccount, useBalance } from "wagmi";

import { robinhoodChain } from "@/shared/lib/chain";
import { env } from "@/shared/lib/env";

import { faucetsFor, type FaucetLinks } from "../config/faucets";

/**
 * Zero-balance faucet trigger (FSD `feature` model — the "get testnet ETH"
 * user action). Shows a CTA when a wallet is connected ON the testnet target
 * and its native balance is exactly 0 — the classic first-visit friction.
 *
 * Docs-first basis (wagmi 2.18, installed source + wagmi.sh, 2026-07-12):
 * `useBalance({ address, chainId, query.enabled })` reads over the config
 * transport (our HTTP RPC), so it works regardless of the wallet's chain; the
 * read is gated to the exact show-conditions to avoid idle RPC traffic.
 *
 * PRECEDENCE: wrong-network outranks this CTA — enforced structurally in the
 * composing widget (widgets/network-banner) AND intrinsically here: the CTA
 * requires `walletChainId === target`, which is false during any mismatch.
 *
 * DISMISSAL: per SESSION, not per render — `sessionStorage` keyed flag, so the
 * banner stays away across navigation/re-renders within the tab session and
 * reappears in a fresh session. Read lazily (SSR-safe: server render returns
 * dismissed=true, which matches the server's null output since `isConnected`
 * is false before hydration — no hydration divergence).
 *
 * E2E harness: hard no-op (`env.e2e()`), mirroring the network guard — the
 * Playwright matrix must never see this DOM.
 */
const DISMISS_KEY = "robbed:faucet-cta-dismissed";

function readDismissed(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Pure show-decision — unit-tested directly (tests/faucet-config.test.ts). */
export function shouldShowFaucetCta(args: {
  faucets: FaucetLinks | null;
  isConnected: boolean;
  walletChainId: number | undefined;
  targetChainId: number;
  balanceWei: bigint | undefined;
  dismissed: boolean;
}): boolean {
  return (
    args.faucets !== null &&
    args.isConnected &&
    args.walletChainId === args.targetChainId &&
    args.balanceWei !== undefined &&
    args.balanceWei === 0n &&
    !args.dismissed
  );
}

export interface FaucetCtaState {
  show: boolean;
  /** Connected address — prefilled into the official faucet deep link. */
  address: string | undefined;
  faucets: FaucetLinks | null;
  targetChainName: string;
  dismiss: () => void;
}

export function useFaucetCta(): FaucetCtaState {
  const faucets = env.e2e() ? null : faucetsFor(robinhoodChain.id);
  const { address, isConnected, chainId: walletChainId } = useAccount();
  const [dismissed, setDismissed] = useState(readDismissed);

  const eligible =
    faucets !== null && isConnected && !!address && walletChainId === robinhoodChain.id;

  const { data: balance } = useBalance({
    address,
    chainId: robinhoodChain.id,
    query: { enabled: eligible && !dismissed },
  });

  const show = shouldShowFaucetCta({
    faucets,
    isConnected,
    walletChainId,
    targetChainId: robinhoodChain.id,
    balanceWei: balance?.value,
    dismissed,
  });

  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // storage unavailable (private mode) — in-memory dismissal still applies.
    }
  };

  return { show, address, faucets, targetChainName: robinhoodChain.name, dismiss };
}
