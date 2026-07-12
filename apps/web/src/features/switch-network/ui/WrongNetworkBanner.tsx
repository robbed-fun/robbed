"use client";

import { BRAND } from "@/shared/config/copy";

import type { NetworkGuard } from "../model/use-network-guard";

/**
 * Wrong-network banner (terminal-mono, dark-only, token colors — no raw
 * values). PRESENTATIONAL ONLY: the guard state is passed in by the composing
 * widget so the `useSwitchChain` mutation (and its one-shot auto-attempt
 * effect) exists exactly ONCE — two hook instances would double-fire the
 * wallet popup.
 *
 * Coexistence with RainbowKit: its ConnectButton already flags "Wrong network"
 * on the wallet chip (single-chain config). This banner complements — it adds
 * the automatic switch attempt (with the add-chain fallback params from the
 * chain object) and a manual retry; it never opens RainbowKit's chain modal.
 *
 * Copy rules (§1, copy-lint): plain AMM/network wording only — no exchange or
 * finality framing, no USD figures, no LP wording.
 */
export function WrongNetworkBanner({ guard }: { guard: NetworkGuard }) {
  if (!guard.mismatch) return null;
  return (
    <div
      role="alert"
      data-testid="wrong-network-banner"
      className="border-b border-border bg-red-dim/40 px-4 py-1.5 text-center text-xs text-red"
    >
      <span>
        Wallet is on chain {guard.walletChainId} — {BRAND} runs on{" "}
        {guard.targetChain.name} (chain {guard.targetChain.id}).
      </span>{" "}
      {guard.isPending ? (
        <span className="text-text-secondary">Confirm the network switch in your wallet…</span>
      ) : (
        <>
          {guard.error && (
            <span className="text-text-secondary">Switch request was declined.</span>
          )}{" "}
          <button
            type="button"
            onClick={guard.retry}
            className="underline decoration-dotted underline-offset-2 transition-colors hover:text-text"
          >
            Switch network
          </button>
        </>
      )}
    </div>
  );
}
