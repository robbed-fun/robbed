/**
 * Redis publish path (indexer.md §8.2/§8.3, §9.3; M2-8): backfill suppression,
 * envelope + per-channel seq, dual-channel trade fanout, the gate-7 fee-recipient
 * alert, and a STRUCTURAL no-DB-import assertion on the hot-path module.
 */
import { describe, expect, it, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PublishGate,
  publishGate,
  publishTrade,
  setDefaultPublisherForTest,
  type RedisPublisher,
} from "../src/publish";
import { feeRecipientAlert } from "../src/alerts";

function capturing() {
  const seqs = new Map<string, number>();
  const messages: Array<{ channel: string; msg: Record<string, unknown> }> = [];
  const publisher: RedisPublisher = {
    async incr(key) {
      const n = (seqs.get(key) ?? 0) + 1;
      seqs.set(key, n);
      return n;
    },
    async publish(channel, message) {
      messages.push({ channel, msg: JSON.parse(message) });
    },
  };
  return { publisher, messages };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

const NOW_MS = 1_700_000_000_000;
const NOW_SEC = Math.floor(NOW_MS / 1000);

// ── backfill suppression latch ──────────────────────────────────────────────

describe("PublishGate — backfill suppression (§9.3)", () => {
  it("stays suppressed for historical events, latches on a recent one", () => {
    const gate = new PublishGate(120, () => NOW_MS);
    gate.observe(NOW_SEC - 10_000); // old backfill block
    expect(gate.enabled).toBe(false);
    gate.observe(NOW_SEC - 5); // caught up to head
    expect(gate.enabled).toBe(true);
    gate.observe(NOW_SEC - 10_000); // a straggler can't un-latch (monotonic)
    expect(gate.enabled).toBe(true);
  });
});

// ── handler publish helpers ─────────────────────────────────────────────────

const tradeInput = (blockTimestamp: number) => ({
  token: "0x" + "aa".repeat(20),
  trader: "0x" + "bb".repeat(20),
  venue: "curve" as const,
  isBuy: true,
  ethAmount: 100n,
  tokenAmount: 10n,
  feeEth: 1n,
  priceEth: 1.5,
  blockNumber: 42,
  txHash: "0x" + "cc".repeat(32),
  logIndex: 3,
  blockTimestamp,
  confirmationState: "soft_confirmed" as const,
});

describe("publishTrade — suppression + dual-channel + envelope", () => {
  beforeEach(() => publishGate.setRealtimeForTest(false));

  it("suppressed during backfill (old block ts)", async () => {
    const { publisher, messages } = capturing();
    setDefaultPublisherForTest(publisher);
    publishTrade(tradeInput(NOW_SEC - 10_000));
    await flush();
    expect(messages).toHaveLength(0);
    setDefaultPublisherForTest(null);
  });

  it("publishes to token:{addr}:trades + global:trades once realtime", async () => {
    const { publisher, messages } = capturing();
    setDefaultPublisherForTest(publisher);
    publishGate.setRealtimeForTest(true);
    publishTrade(tradeInput(NOW_SEC - 5));
    await flush();

    const channels = messages.map((m) => m.channel).sort();
    expect(channels).toEqual(["global:trades", `token:0x${"aa".repeat(20)}:trades`]);
    const env = messages[0]!.msg;
    expect(env.v).toBe(1);
    expect(env.type).toBe("trade");
    expect(env.seq).toBe(1); // per-channel INCR
    expect((env.data as { ethAmount: string }).ethAmount).toBe("100"); // uint256 as decimal string
    setDefaultPublisherForTest(null);
  });
});

// ── gate-7 fee-recipient alert ──────────────────────────────────────────────

describe("feeRecipientAlert (§9.4)", () => {
  const treasury = "0x" + "11".repeat(20);
  const ctx = { token: "0xtok", txHash: "0xtx" };

  it("no alert when recipient == treasury (case-insensitive)", () => {
    expect(feeRecipientAlert(treasury.toUpperCase(), treasury, ctx)).toBeNull();
  });
  it("alerts when recipient != treasury", () => {
    const a = feeRecipientAlert("0x" + "99".repeat(20), treasury, ctx);
    expect(a?.key).toBe("fee_collections.recipient_mismatch");
    expect(a?.message).toContain("PAGE");
  });
  it("no alert (unverifiable) when treasury is unconfigured", () => {
    expect(feeRecipientAlert("0x" + "99".repeat(20), undefined, ctx)).toBeNull();
  });
});

// ── structural: hot-path module imports no DB client ────────────────────────

describe("publish.ts — no DB in the hot path (§8.3)", () => {
  const text = readFileSync(join(import.meta.dir, "..", "src", "publish.ts"), "utf8");

  // Scan IMPORT SPECIFIERS (not prose — the docstring mentions DB module names
  // precisely to say it does NOT import them). publish.ts may only import shared.
  it("imports only from @robbed/shared (no ponder/pg/DB modules)", () => {
    const imports = [...text.matchAll(/from ["']([^"']+)["']/g)].map((m) => m[1]!);
    for (const spec of imports) {
      expect(spec.startsWith("@robbed/shared") || spec.startsWith("node:")).toBe(true);
    }
  });

  it("does not read the Ponder context db or a pg pool", () => {
    // These substrings would only appear as CODE, never in this module's prose.
    expect(text.includes("context.db")).toBe(false);
    expect(text.includes("new Pool(")).toBe(false);
    expect(text.includes("db.insert(")).toBe(false);
  });
});
