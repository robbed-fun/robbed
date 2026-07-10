"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";

import { createWagmiConfig } from "@/shared/lib/wagmi";
import { WsProvider } from "@/shared/lib/ws";

/**
 * Provider stack (web.md §2.5), outermost → innermost:
 *   WagmiProvider → QueryClientProvider → RainbowKitProvider(dark) → WsProvider.
 *
 * Docs-first (2026-07-10): wagmi.sh SSR guide, rainbowkit.com theming,
 * tanstack.com/query/latest. Config + QueryClient are created once per client
 * (lazy `useState` initializer) so they survive Fast Refresh and aren't rebuilt
 * on every render. RainbowKit is dark-only (§12.23) — no theme toggle.
 *
 * ROBBED_ (Phase F): RainbowKit accent = the green token, square corners.
 * `var(--color-green)` is passed as a CSS-var REFERENCE (RainbowKit themes
 * compile to CSS custom properties, so var() indirection resolves in-browser) —
 * no raw hex leaves globals.css (token-bypass lint).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [wagmiConfig] = useState(() => createWagmiConfig());
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Live-ness comes from WS cache patching; polling is the degraded
            // fallback (web.md §2.5). Modest staleTime + retry.
            staleTime: 5_000,
            refetchOnWindowFocus: true,
            retry: 2,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "var(--color-green)",
            accentColorForeground: "var(--color-accent-foreground)",
            borderRadius: "none",
          })}
          modalSize="compact"
        >
          <WsProvider>{children}</WsProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
