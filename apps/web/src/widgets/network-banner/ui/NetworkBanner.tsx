"use client";

import { FaucetCta } from "@/features/get-testnet-eth";
import { WrongNetworkBanner, useNetworkGuard } from "@/features/switch-network";

/**
 * Onboarding-friction banner region (FSD `widget` — composes the
 * `switch-network` and `get-testnet-eth` features for the top-of-page strip,
 * mounted by every view next to `LiveStatusBanner`).
 *
 * PRECEDENCE: wrong network outranks the faucet CTA — a zero balance on the
 * WRONG chain is meaningless until the wallet is on the target chain. The
 * single `useNetworkGuard()` instance lives HERE (the banner is
 * presentational) so the one-shot auto-switch effect can never double-fire.
 *
 * E2E: renders nothing — the mock connector is always on the configured chain
 * (mismatch structurally false) and both features hard-gate on
 * `NEXT_PUBLIC_E2E`, so the 44/44 Playwright matrix sees zero extra DOM.
 */
export function NetworkBanner() {
  const guard = useNetworkGuard();
  if (guard.mismatch) return <WrongNetworkBanner guard={guard} />;
  return <FaucetCta />;
}
