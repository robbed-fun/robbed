import { QueryClient } from "@tanstack/react-query";
import { GLOBAL_CONFIRMATIONS, GLOBAL_TRADES } from "@robbed/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LIVE_QUERY_PREFIXES } from "@/shared/lib/query-keys";
import { WsClient, type WsLike } from "@/shared/lib/ws-client";

/**
 * WS reconnect + seq-gap + watermark proofs (spec §2.1/§12.20/§12.23; web.md
 * decide-it-yourself "WS reconnect + backfill"). Awaiting the reconcile pass to
 * execute; the logic under test is React-free (ws-client.ts).
 */

const OPEN = 1;

class MockSocket implements WsLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.triggerClose();
  }
  triggerOpen() {
    this.readyState = OPEN;
    this.onopen?.({});
  }
  triggerClose() {
    this.readyState = 3;
    this.onclose?.({});
  }
  deliver(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function confirmationsFrame(seq: number, safeBlock: number, finalizedBlock: number) {
  return {
    v: 1,
    type: "confirmations",
    channel: GLOBAL_CONFIRMATIONS,
    seq,
    ts: 1,
    data: { safeBlock, finalizedBlock },
  };
}

function tradeFrame(seq: number) {
  return {
    v: 1,
    type: "trade",
    channel: GLOBAL_TRADES,
    seq,
    ts: 1,
    data: {
      token: "0x0000000000000000000000000000000000000001",
      trader: "0x0000000000000000000000000000000000000002",
      venue: "curve",
      isBuy: true,
      ethAmount: "1000000000000000000",
      tokenAmount: "5000000000000000000000",
      feeEth: "10000000000000000",
      priceEth: 0.0002,
      blockNumber: 100,
      txHash: "0x" + "ab".repeat(32),
      logIndex: 0,
      blockTimestamp: 1,
      confirmationState: "soft_confirmed",
    },
  };
}

/**
 * Index helper: asserts the element exists (tsconfig `noUncheckedIndexedAccess`
 * types `arr[i]` as `T | undefined`). A missing socket/timer then surfaces as an
 * explicit test failure — not a silenced non-null cast — so the reconnect /
 * seq-gap semantics under test (§12.20/§12.23) stay fully asserted.
 */
function nth<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected array element at index ${i}`);
  return v;
}

function makeClient() {
  const sockets: MockSocket[] = [];
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const scheduled: Array<() => void> = [];
  const client = new WsClient({
    url: "wss://ws.test.invalid",
    queryClient,
    createSocket: () => {
      const s = new MockSocket();
      sockets.push(s);
      return s;
    },
    // Capture reconnect callbacks instead of using real timers.
    schedule: (fn) => {
      scheduled.push(fn);
      return scheduled.length - 1;
    },
    cancel: () => {},
  });
  return { client, sockets, invalidateSpy, scheduled, queryClient };
}

describe("WsClient reconnect", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("does NOT invalidate on the first open", () => {
    const { client, sockets, invalidateSpy } = makeClient();
    client.connect();
    nth(sockets, 0).triggerOpen();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("invalidates ALL live families on reconnect (no replay buffer, §12.23)", () => {
    const { client, sockets, invalidateSpy, scheduled } = makeClient();
    client.connect();
    nth(sockets, 0).triggerOpen();
    invalidateSpy.mockClear();

    // Drop the socket → a reconnect is scheduled.
    nth(sockets, 0).triggerClose();
    expect(scheduled.length).toBe(1);
    nth(scheduled, 0)(); // run the scheduled reconnect
    nth(sockets, 1).triggerOpen();

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (c) => (c[0] as { queryKey: string[] }).queryKey[0],
    );
    for (const prefix of LIVE_QUERY_PREFIXES) {
      expect(invalidatedKeys).toContain(prefix);
    }
  });

  it("re-subscribes active channels after reconnect", () => {
    const { client, sockets, scheduled } = makeClient();
    client.connect();
    nth(sockets, 0).triggerOpen();
    client.subscribe(GLOBAL_TRADES, () => {});

    nth(sockets, 0).triggerClose();
    nth(scheduled, 0)();
    nth(sockets, 1).triggerOpen();

    const subs = nth(sockets, 1).sent.filter((s) => s.includes('"sub"'));
    expect(subs.some((s) => s.includes(GLOBAL_TRADES))).toBe(true);
  });
});

describe("WsClient seq-gap heal", () => {
  it("REST-heals (invalidates live families) on a per-channel seq gap", () => {
    const { client, sockets, invalidateSpy } = makeClient();
    client.connect();
    nth(sockets, 0).triggerOpen();
    client.subscribe(GLOBAL_TRADES, () => {});
    invalidateSpy.mockClear();

    nth(sockets, 0).deliver(tradeFrame(1)); // establishes lastSeq
    expect(invalidateSpy).not.toHaveBeenCalled();
    nth(sockets, 0).deliver(tradeFrame(3)); // gap: expected 2
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("does not heal on contiguous seq", () => {
    const { client, sockets, invalidateSpy } = makeClient();
    client.connect();
    nth(sockets, 0).triggerOpen();
    client.subscribe(GLOBAL_TRADES, () => {});
    invalidateSpy.mockClear();

    nth(sockets, 0).deliver(tradeFrame(1));
    nth(sockets, 0).deliver(tradeFrame(2));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("WsClient confirmation watermark (§12.20)", () => {
  it("stores + notifies watermark advances from the O(1) broadcast", () => {
    const { client, sockets } = makeClient();
    const seen: number[] = [];
    client.onWatermarks((w) => seen.push(Number(w.finalizedBlock)));
    client.connect();
    nth(sockets, 0).triggerOpen();

    nth(sockets, 0).deliver(confirmationsFrame(1, 50, 40));
    expect(client.getWatermarks()).toEqual({ safeBlock: 50, finalizedBlock: 40 });
    expect(seen).toContain(40);
  });

  it("dispatches channel messages to subscribers", () => {
    const { client, sockets } = makeClient();
    const received: unknown[] = [];
    client.connect();
    nth(sockets, 0).triggerOpen();
    client.subscribe(GLOBAL_TRADES, (m) => received.push(m));
    nth(sockets, 0).deliver(tradeFrame(1));
    expect(received.length).toBe(1);
  });
});
