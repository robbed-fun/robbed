import type { QueryClient } from "@tanstack/react-query";
import {
  type ConfirmationWatermarks,
  type WsMessage,
  GLOBAL_CONFIRMATIONS,
  wsMessageSchema,
} from "@robbed/shared";

import { LIVE_QUERY_PREFIXES } from "./query-keys";

/**
 * Multiplexed WS client (spec §2.1/§5; web.md §2.5; indexer.md §8). ONE socket
 * for the whole app; components subscribe to channels through the React
 * `WsProvider` (lib/ws.tsx) which owns a single instance of this class.
 *
 * Framework-agnostic + dependency-injected (socket factory, scheduler,
 * QueryClient) so tests/ws-reconnect.test.ts can drive reconnect + seq-gap +
 * watermark paths with a mock socket and a real QueryClient — no jsdom WebSocket.
 *
 * RECONCILIATION DECISIONS (recorded here; proven by ws-reconnect.test.ts):
 * - No replay buffer exists (spec §12.23), so on EITHER a reconnect OR a per-
 *   channel `seq` gap we invalidate ALL live query families and let REST re-serve
 *   resumable truth. This is the safest correct option: it can never surface a
 *   dropped or stale trade. Alternatives (per-channel replay, targeted family
 *   invalidation) are unavailable / strictly riskier given no server buffer.
 * - Confirmation tiers upgrade from the O(1) `confirmations` watermark broadcast
 *   (spec §12.20), NOT per-row messages; we store the watermark and notify
 *   listeners (the M3-7 trade reducer derives posted/finalized locally).
 */

/** Minimal socket surface — satisfied by browser `WebSocket` and test doubles. */
export interface WsLike {
  send(data: string): void;
  close(): void;
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type WsHandler = (msg: WsMessage) => void;
export type WatermarkListener = (w: ConfirmationWatermarks) => void;

export interface WsClientOptions {
  url: string;
  queryClient: QueryClient;
  createSocket: (url: string) => WsLike;
  /** Overridable for tests (default `setTimeout`). */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  /** Backoff bounds (web.md §2.5: 0.5s → 8s, jitter). */
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** Called when connectivity state flips (drives the degraded banner). */
  onStatusChange?: (status: WsStatus) => void;
}

export type WsStatus = "connecting" | "open" | "reconnecting" | "closed";

const OPEN = 1;

export class WsClient {
  private opts: Required<
    Omit<WsClientOptions, "onStatusChange">
  > & { onStatusChange?: (s: WsStatus) => void };
  private socket: WsLike | null = null;
  private handlers = new Map<string, Set<WsHandler>>();
  private lastSeq = new Map<string, number>();
  private watermarkListeners = new Set<WatermarkListener>();
  private watermarks: ConfirmationWatermarks = { safeBlock: 0, finalizedBlock: 0 };
  private hasConnectedOnce = false;
  private attempt = 0;
  private manuallyClosed = false;
  private reconnectHandle: unknown = null;
  private status: WsStatus = "closed";

  constructor(options: WsClientOptions) {
    this.opts = {
      url: options.url,
      queryClient: options.queryClient,
      createSocket: options.createSocket,
      schedule: options.schedule ?? ((fn, ms) => setTimeout(fn, ms)),
      cancel: options.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
      minBackoffMs: options.minBackoffMs ?? 500,
      maxBackoffMs: options.maxBackoffMs ?? 8000,
      onStatusChange: options.onStatusChange,
    };
  }

  getWatermarks(): ConfirmationWatermarks {
    return this.watermarks;
  }

  getStatus(): WsStatus {
    return this.status;
  }

  /** Seed the watermark from the SSR REST snapshot (api.md GET /v1/confirmations). */
  seedWatermarks(w: ConfirmationWatermarks): void {
    this.watermarks = w;
    this.emitWatermarks();
  }

  onWatermarks(listener: WatermarkListener): () => void {
    this.watermarkListeners.add(listener);
    listener(this.watermarks);
    return () => this.watermarkListeners.delete(listener);
  }

  connect(): void {
    this.manuallyClosed = false;
    this.open();
  }

  private open(): void {
    this.setStatus(this.hasConnectedOnce ? "reconnecting" : "connecting");
    const socket = this.opts.createSocket(this.opts.url);
    this.socket = socket;
    socket.onopen = () => this.handleOpen();
    socket.onclose = () => this.handleClose();
    socket.onmessage = (ev) => this.handleMessage(ev.data);
    socket.onerror = () => {
      /* errors surface as a close; no-op here */
    };
  }

  private handleOpen(): void {
    this.attempt = 0;
    this.setStatus("open");
    // (Re)subscribe every active channel.
    for (const channel of this.handlers.keys()) this.sendOp({ op: "sub", channel });
    // global:confirmations is always live so tier upgrades never stall.
    if (!this.handlers.has(GLOBAL_CONFIRMATIONS)) {
      this.sendOp({ op: "sub", channel: GLOBAL_CONFIRMATIONS });
    }
    if (this.hasConnectedOnce) {
      // Reconnect: close the gap of any events missed while down (no replay
      // buffer, §12.23) by invalidating every live family — REST is truth.
      this.invalidateAllLive();
      this.lastSeq.clear();
    }
    this.hasConnectedOnce = true;
  }

  private handleClose(): void {
    this.socket = null;
    if (this.manuallyClosed) {
      this.setStatus("closed");
      return;
    }
    this.setStatus("reconnecting");
    const base = Math.min(
      this.opts.maxBackoffMs,
      this.opts.minBackoffMs * 2 ** this.attempt,
    );
    const jitter = Math.random() * this.opts.minBackoffMs;
    this.attempt += 1;
    this.reconnectHandle = this.opts.schedule(() => this.open(), base + jitter);
  }

  private handleMessage(raw: unknown): void {
    let parsed: WsMessage;
    try {
      parsed = wsMessageSchema.parse(typeof raw === "string" ? JSON.parse(raw) : raw);
    } catch {
      return; // ignore malformed frames — never crash the socket
    }

    // seq-gap detection per channel → REST-heal (invalidate all live families).
    const prev = this.lastSeq.get(parsed.channel);
    if (prev !== undefined && parsed.seq !== prev + 1) {
      this.invalidateAllLive();
    }
    this.lastSeq.set(parsed.channel, parsed.seq);

    // Watermark advances (spec §12.20) — store + notify; no per-row fanout.
    if (parsed.type === "confirmations") {
      this.watermarks = {
        safeBlock: parsed.data.safeBlock,
        finalizedBlock: parsed.data.finalizedBlock,
      };
      this.emitWatermarks();
    }
    // Reorg → the local optimistic/indexed picture may be wrong; re-heal (indexer.md §5.3).
    if (parsed.type === "reorg") {
      this.invalidateAllLive();
    }

    const set = this.handlers.get(parsed.channel);
    if (set) for (const h of set) h(parsed);
  }

  /** Ref-counted subscribe. Returns an unsubscribe that only unsubs at count 0. */
  subscribe(channel: string, handler: WsHandler): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      if (this.socket && this.socket.readyState === OPEN) {
        this.sendOp({ op: "sub", channel });
      }
    }
    set.add(handler);
    return () => {
      const s = this.handlers.get(channel);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) {
        this.handlers.delete(channel);
        if (this.socket && this.socket.readyState === OPEN) {
          this.sendOp({ op: "unsub", channel });
        }
        this.lastSeq.delete(channel);
      }
    };
  }

  close(): void {
    this.manuallyClosed = true;
    if (this.reconnectHandle) this.opts.cancel(this.reconnectHandle);
    this.socket?.close();
    this.socket = null;
    this.setStatus("closed");
  }

  private invalidateAllLive(): void {
    for (const prefix of LIVE_QUERY_PREFIXES) {
      void this.opts.queryClient.invalidateQueries({ queryKey: [prefix] });
    }
  }

  private sendOp(op: { op: "sub" | "unsub"; channel: string } | { op: "ping" }): void {
    try {
      this.socket?.send(JSON.stringify(op));
    } catch {
      /* socket may have closed between the check and send */
    }
  }

  private emitWatermarks(): void {
    for (const l of this.watermarkListeners) l(this.watermarks);
  }

  private setStatus(status: WsStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.opts.onStatusChange?.(status);
  }
}
