"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

import { env } from "@/shared/lib/env";
import { shortAddress } from "@/shared/lib/format";
import { MOCK_PORTFOLIO_ADDRESS } from "@/shared/mock/mock-api";

/**
 * Wallet connection (FSD `feature` — a user action). Thin wrapper over RainbowKit's
 * `ConnectButton` so the wallet-connect interaction is a single reusable slice
 * (site header today; trade/launch CTAs later). Connectors (injected · Robinhood
 * Wallet · WalletConnect) are wired in the app-layer wagmi config (M3-3); this
 * component only presents the connect/account control.
 *
 * DEMO MODE (task A): the mockup header shows a connected wallet as a muted
 * address chip ("0x7fA3…c92E"), not a connect CTA. Strictly gated — the real
 * connect flow is untouched when the flag is off.
 */
export function WalletConnectButton() {
  if (env.mockData()) {
    return (
      <span className="shrink-0 text-sm tabular-nums text-muted">
        {shortAddress(MOCK_PORTFOLIO_ADDRESS)}
      </span>
    );
  }
  return (
    <ConnectButton showBalance={false} accountStatus="avatar" chainStatus="icon" />
  );
}
