"use client";

import { createContext, useContext } from "react";

import {
  type OptimisticTradesApi,
  type UseOptimisticTradesOptions,
  useOptimisticTrades,
} from "./use-optimistic-trades";

/**
 * Shared optimistic-trades store for one Token Detail screen.
 *
 * WHY a context in the entity layer: the TradeWidget (which SUBMITS a trade) and
 * the TradeFeed (which DISPLAYS it) are sibling widgets — FSD forbids them
 * importing each other. Lifting the single `useOptimisticTrades` store into the
 * trade entity and exposing it via context lets the view compose one provider
 * around both widgets, so a buy placed in the widget appears optimistically in
 * the feed and reconciles once (spec §4). Both widgets read this via the entity's
 * public API; the view owns the provider.
 */
const OptimisticTradesContext = createContext<OptimisticTradesApi | null>(null);

export function OptimisticTradesProvider({
  children,
  options,
}: {
  children: React.ReactNode;
  options?: UseOptimisticTradesOptions;
}) {
  const api = useOptimisticTrades(options);
  return (
    <OptimisticTradesContext.Provider value={api}>
      {children}
    </OptimisticTradesContext.Provider>
  );
}

/** Access the shared store. Throws if used outside the provider (misuse guard). */
export function useOptimisticTradesContext(): OptimisticTradesApi {
  const ctx = useContext(OptimisticTradesContext);
  if (!ctx) {
    throw new Error(
      "[robbed/web] useOptimisticTradesContext must be used within <OptimisticTradesProvider> " +
        "(rendered by views/token-detail).",
    );
  }
  return ctx;
}
