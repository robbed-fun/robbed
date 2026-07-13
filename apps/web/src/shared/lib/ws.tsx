"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ConfirmationWatermarks } from "@robbed/shared";

import { env } from "./env";
import { WsClient, type WsHandler, type WsLike, type WsStatus } from "./ws-client";

/**
 * React binding for the multiplexed `WsClient` (web.md §2.5). Provides:
 *   - `useWsChannel(channel, handler)` — ref-counted subscription
 *   - `useConfirmationWatermarks()`   — live safe/finalized blocks (§12.20)
 *   - `useWsStatus()`                 — drives the "Live updates degraded" banner
 *
 * One socket per app; the client is created once and connected for the tree's
 * lifetime. The transport logic + tests live in ws-client.ts (no React needed).
 */

interface WsContextValue {
  client: WsClient;
}
const WsContext = createContext<WsContextValue | null>(null);

/** Browser WebSocket adapter → `WsLike`. */
function browserSocketFactory(url: string): WsLike {
  return new WebSocket(url) as unknown as WsLike;
}

export function WsProvider({
  children,
  seedWatermarks,
}: {
  children: React.ReactNode;
  /** Optional SSR seed from GET /v1/confirmations (spec §12.20). */
  seedWatermarks?: ConfirmationWatermarks;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<WsStatus>("connecting");
  const clientRef = useRef<WsClient | null>(null);

  if (clientRef.current === null && typeof window !== "undefined") {
    clientRef.current = new WsClient({
      url: env.wsUrl(),
      queryClient,
      createSocket: browserSocketFactory,
      onStatusChange: setStatus,
    });
    if (seedWatermarks) clientRef.current.seedWatermarks(seedWatermarks);
  }

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    client.connect();
    return () => client.close();
  }, []);

  const value = useMemo<WsContextValue | null>(
    () => (clientRef.current ? { client: clientRef.current } : null),
    [],
  );

  return (
    <WsContext.Provider value={value}>
      {/* status is read via useWsStatus; kept here to trigger re-renders */}
      <WsStatusContext.Provider value={status}>{children}</WsStatusContext.Provider>
    </WsContext.Provider>
  );
}

const WsStatusContext = createContext<WsStatus>("connecting");

export function useWsStatus(): WsStatus {
  return useContext(WsStatusContext);
}

function useWsClient(): WsClient | null {
  return useContext(WsContext)?.client ?? null;
}

/**
 * Subscribe to a channel for the component's lifetime. Handler identity may
 * change every render; we keep a ref so the subscription is stable and only the
 * `channel` re-subscribes.
 */
export function useWsChannel(channel: string | null, handler: WsHandler): void {
  const client = useWsClient();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!client || !channel) return;
    const unsub = client.subscribe(channel, (msg) => handlerRef.current(msg));
    return unsub;
  }, [client, channel]);
}

/**
 * Stable default snapshot. `useSyncExternalStore` requires BOTH getSnapshot and
 * getServerSnapshot to return a CACHED reference — a fresh object literal each
 * call is read as a changed snapshot → React's "getServerSnapshot should be
 * cached to avoid an infinite loop" render crash. `client.getWatermarks()`
 * already returns a stable ref (ws-client caches `this.watermarks`); this const
 * covers the disconnected + SSR paths with a single frozen reference.
 */
const EMPTY_WATERMARKS: ConfirmationWatermarks = Object.freeze({
  safeBlock: 0,
  finalizedBlock: 0,
});

/** Live confirmation watermark (safe/finalized blocks) — spec §12.20. */
export function useConfirmationWatermarks(): ConfirmationWatermarks {
  const client = useWsClient();
  return useSyncExternalStore(
    (onChange) => (client ? client.onWatermarks(() => onChange()) : () => {}),
    () => client?.getWatermarks() ?? EMPTY_WATERMARKS,
    () => EMPTY_WATERMARKS,
  );
}
