"use client";

import { useEffect } from "react";
import type { Config } from "wagmi";
import { connect, disconnect, getAccount, switchAccount } from "wagmi/actions";

import { env } from "./env";

/**
 * E2E wallet bridge (I-5a). Mounts ONLY when `NEXT_PUBLIC_E2E=true`. Exposes a
 * tiny imperative bridge on `window.__ROBBED_E2E__` so Playwright can drive the
 * anvil-backed mock connector without any browser-extension automation:
 *
 *   await page.evaluate(() => window.__ROBBED_E2E__.connect(0))   // account #0
 *   await page.evaluate(() => window.__ROBBED_E2E__.switchAccount(1))
 *   await page.evaluate(() => window.__ROBBED_E2E__.address())
 *
 * The bridge is a NO-OP in production (component returns null before mount when
 * the flag is off). It carries no market data and no secrets — the accounts are
 * anvil's public dev accounts, unlocked on the fork.
 *
 * Docs-first (2026-07-10): wagmi.sh/react/api/actions (`connect`, `disconnect`,
 * `switchAccount`, `getAccount`) + /react/api/connectors/mock.
 */
declare global {
  interface Window {
    __ROBBED_E2E__?: {
      connect: (accountIndex?: number) => Promise<string | undefined>;
      switchAccount: (accountIndex: number) => Promise<string | undefined>;
      disconnect: () => Promise<void>;
      address: () => string | undefined;
      isConnected: () => boolean;
    };
  }
}

export function E2eWalletBridge({ config }: { config: Config }) {
  useEffect(() => {
    if (!env.e2e() || typeof window === "undefined") return;

    // One mock connector per anvil account (wagmi.ts buildE2eConnectors).
    const connectorAt = (i: number) => config.connectors[i] ?? config.connectors[0];

    window.__ROBBED_E2E__ = {
      async connect(accountIndex = 0) {
        const target = connectorAt(accountIndex);
        if (!target) return getAccount(config).address;
        if (!getAccount(config).isConnected) {
          await connect(config, { connector: target });
        } else if (getAccount(config).connector?.uid !== target.uid) {
          await switchAccount(config, { connector: target });
        }
        return getAccount(config).address;
      },
      async switchAccount(accountIndex: number) {
        const target = connectorAt(accountIndex);
        if (target) await switchAccount(config, { connector: target });
        return getAccount(config).address;
      },
      async disconnect() {
        await disconnect(config);
      },
      address() {
        return getAccount(config).address;
      },
      isConnected() {
        return getAccount(config).isConnected;
      },
    };

    return () => {
      delete window.__ROBBED_E2E__;
    };
  }, [config]);

  return null;
}
