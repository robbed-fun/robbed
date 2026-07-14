"use client";

import { useEffect, useRef } from "react";
import { useAccount, useSwitchChain } from "wagmi";

import { robinhoodChain } from "@/shared/lib/chain";
import { env } from "@/shared/lib/env";

/**
 * Wrong-network detection + auto-switch (FSD `feature` model segment — the
 * "switch network" user action; feature-sliced.design/docs/reference/layers).
 *
 * Docs-first basis (2026-07-12, verified against the INSTALLED wagmi 2.18.0
 * source — wagmi.sh now serves v3 docs):
 * - `useAccount().chainId` is the wallet's ACTUAL chain id (even when not in
 *   the wagmi config; `.chain` would be undefined then) and re-renders on the
 *   provider's `chainChanged` events — so connect AND chain-change are both
 *   covered by deriving from it.
 * - `useSwitchChain().switchChain({ chainId })` → connector `switchChain` →
 *   `wallet_switchEthereumChain`; on error 4902 (chain unknown to the wallet)
 *   the injected connector falls back to `wallet_addEthereumChain` built from
 *   the config chain object (name/nativeCurrency/rpcUrls.default.http[0]/
 *   blockExplorers) — which is why `robinhoodChain` must carry the official
 *   per-target params (shared/lib/chain.ts). WalletConnect connectors relay
 *   the same request over the WC session. Rejection surfaces as
 *   `UserRejectedRequestError` on `error`.
 *
 * DECISION (auto-switch policy, decide-yourself loop): exactly ONE automatic
 * `switchChain` attempt per mismatch EPISODE (keyed connector.uid + wallet
 * chain id); afterwards only the manual button retries. Alternatives — retry
 * on every render (rejected: hostile popup loop, can wedge WC sessions) or no
 * auto attempt (rejected: task requires auto-switch). Verified by
 * tests/network-banner.test.tsx (auto-called once; rejection → manual).
 *
 * E2E harness (`NEXT_PUBLIC_E2E`): hard no-op — the wagmi mock connector is
 * always on the configured chain so `mismatch` is structurally false, and the
 * explicit gate makes the guarantee independent of mock internals (44/44
 * Playwright matrix untouched).
 */
export interface NetworkGuard {
  /** True while the connected wallet is on a different chain than the app target. */
  mismatch: boolean;
  /** The wallet's current chain id (undefined when disconnected). */
  walletChainId: number | undefined;
  /** The app's single target chain (env-selected). */
  targetChain: typeof robinhoodChain;
  /** True while a switch request is awaiting the wallet. */
  isPending: boolean;
  /** Set when the last switch attempt failed / was declined. */
  error: Error | null;
  /** Manual retry — the fallback CTA when the auto-attempt was declined. */
  retry: () => void;
}

/**
 * Explicit `wallet_addEthereumChain` params so a wallet that does NOT yet have
 * Robinhood Chain configured ADDS it on switch — rather than relying only on the
 * connector's implicit 4902 fallback (unreliable across wallets/WC sessions).
 * Built from the single `robinhoodChain` config object so name / RPC / explorer /
 * native currency stay the canonical official values (never invented). The
 * wagmi/core 2.22 `switchChain` mutation accepts this per-call variable (verified
 * against the installed `@wagmi/core` type). rpcUrls/blockExplorerUrls must be
 * PUBLIC URLs the wallet can reach (they come from the env RPC + Blockscout).
 */
const ADD_CHAIN_PARAMETER = {
  chainName: robinhoodChain.name,
  nativeCurrency: { ...robinhoodChain.nativeCurrency },
  rpcUrls: [...robinhoodChain.rpcUrls.default.http],
  blockExplorerUrls: [robinhoodChain.blockExplorers.default.url],
};

export function useNetworkGuard(): NetworkGuard {
  const { isConnected, chainId: walletChainId, connector } = useAccount();
  const { switchChain, isPending, error, reset } = useSwitchChain();

  const mismatch =
    !env.e2e() &&
    isConnected &&
    typeof walletChainId === "number" &&
    walletChainId !== robinhoodChain.id;

  // One auto-attempt per mismatch episode (connector + wrong chain id). A ref —
  // not state — so a re-render can never re-fire the wallet popup.
  const attempted = useRef<Set<string>>(new Set());
  const episode = `${connector?.uid ?? "none"}:${walletChainId ?? 0}`;

  useEffect(() => {
    if (!mismatch) return;
    if (attempted.current.has(episode)) return;
    attempted.current.add(episode);
    switchChain({
      chainId: robinhoodChain.id,
      addEthereumChainParameter: ADD_CHAIN_PARAMETER,
    });
  }, [mismatch, episode, switchChain]);

  const retry = () => {
    reset();
    switchChain({
      chainId: robinhoodChain.id,
      addEthereumChainParameter: ADD_CHAIN_PARAMETER,
    });
  };

  return {
    mismatch,
    walletChainId,
    targetChain: robinhoodChain,
    isPending,
    error: error ?? null,
    retry,
  };
}
