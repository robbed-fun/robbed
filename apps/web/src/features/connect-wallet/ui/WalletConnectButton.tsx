"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

/**
 * Wallet connection (FSD `feature` — a user action). Thin wrapper over RainbowKit's
 * `ConnectButton` so the wallet-connect interaction is a single reusable slice
 * (site header today; trade/launch CTAs later). Connectors (injected · Robinhood
 * Wallet · WalletConnect) are wired in the app-layer wagmi config (M3-3); this
 * component only presents the connect/account control.
 */
export function WalletConnectButton() {
  return (
    <ConnectButton showBalance={false} accountStatus="avatar" chainStatus="icon" />
  );
}
