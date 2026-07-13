import { type WsMessage, wsMessageSchema } from "@robbed/shared";
import type { CreatorTokenClaimable } from "@robbed/shared";
import { describe, expect, it } from "vitest";

import {
  bucketFromApiRow,
  hasClaimable,
  sortBuckets,
} from "@/entities/creator";
import { isCreatorFeeUpdateFor } from "@/widgets/creator-earnings/model/ws";

/**
 * Post-graduation creator-fee (§12.69) — WS reconcile decision + bucket projection.
 *
 * The reconcile rule (§2.1/§5): a `creator_fee_split` (accrual) or
 * `creator_fee_claimed` (payout) for THIS creator must trigger a refetch of the
 * AUTHORITATIVE claimable (reconcile-to-indexed-truth), and an event for ANOTHER
 * creator must NEVER clobber the subject's cache. Proven here on the pure decision
 * so it holds without React/WS wiring.
 */

const CREATOR = "0x00000000000000000000000000000000000000aa" as const;
const OTHER = "0x00000000000000000000000000000000000000bb" as const;
const TOKEN = "0x00000000000000000000000000000000000000cc" as const;
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73" as const;
const VAULT = "0x00000000000000000000000000000000000000ee" as const;
const TX = `0x${"1".repeat(64)}` as const;

function splitMsg(creator: string): WsMessage {
  return wsMessageSchema.parse({
    v: 1,
    channel: `token:${TOKEN}:events`,
    seq: 1,
    ts: 1_700_000_000,
    type: "creator_fee_split",
    data: {
      token: TOKEN,
      creator,
      creatorAmountToken: "500",
      creatorAmountWeth: "250",
      treasuryAmountToken: "500",
      treasuryAmountWeth: "250",
      blockNumber: 100,
      blockTimestamp: 1_700_000_000,
      txHash: TX,
      logIndex: 0,
      confirmationState: "soft_confirmed",
    },
  });
}

function claimedMsg(creator: string, confirmationState = "soft_confirmed"): WsMessage {
  return wsMessageSchema.parse({
    v: 1,
    channel: `token:${TOKEN}:events`,
    seq: 2,
    ts: 1_700_000_001,
    type: "creator_fee_claimed",
    data: {
      creator,
      token: WETH,
      amount: "750",
      blockNumber: 101,
      blockTimestamp: 1_700_000_001,
      txHash: TX,
      logIndex: 1,
      confirmationState,
    },
  });
}

/** An unrelated fee event (treasury-only `Collect`) — NOT a creator-fee WS type. */
function feeCollectedMsg(): WsMessage {
  return wsMessageSchema.parse({
    v: 1,
    channel: `token:${TOKEN}:events`,
    seq: 3,
    ts: 1_700_000_002,
    type: "fee_collected",
    data: {
      token: TOKEN,
      recipient: VAULT,
      amountToken: "1000",
      amountWeth: "500",
      blockNumber: 102,
      blockTimestamp: 1_700_000_002,
      txHash: TX,
      logIndex: 2,
      confirmationState: "soft_confirmed",
    },
  });
}

describe("isCreatorFeeUpdateFor (WS reconcile decision, §12.69)", () => {
  it("accrual split for THIS creator → refetch authoritative claimable", () => {
    expect(isCreatorFeeUpdateFor(splitMsg(CREATOR), CREATOR)).toBe(true);
  });

  it("claim for THIS creator → reconcile optimistic claim to indexed truth", () => {
    expect(isCreatorFeeUpdateFor(claimedMsg(CREATOR), CREATOR)).toBe(true);
    expect(isCreatorFeeUpdateFor(claimedMsg(CREATOR, "posted_to_l1"), CREATOR)).toBe(true);
  });

  it("case-insensitive on the creator address", () => {
    expect(isCreatorFeeUpdateFor(splitMsg(CREATOR), CREATOR.toUpperCase())).toBe(true);
  });

  it("split/claim for ANOTHER creator → ignored (never clobbers the subject cache)", () => {
    expect(isCreatorFeeUpdateFor(splitMsg(OTHER), CREATOR)).toBe(false);
    expect(isCreatorFeeUpdateFor(claimedMsg(OTHER), CREATOR)).toBe(false);
  });

  it("unrelated message types (e.g. fee_collected) → ignored", () => {
    expect(isCreatorFeeUpdateFor(feeCollectedMsg(), CREATOR)).toBe(false);
  });
});

describe("post-grad bucket projection (§12.69)", () => {
  const row = (over: Partial<CreatorTokenClaimable>): CreatorTokenClaimable => ({
    creator: CREATOR,
    token: TOKEN,
    vault: VAULT,
    claimable: "1000",
    claimableUsd: null,
    totalAccrued: "1000",
    totalClaimed: "0",
    asOf: "2026-07-13T00:00:00.000Z",
    ...over,
  });

  it("maps an API row → view bucket, flagging the WETH leg", () => {
    expect(bucketFromApiRow(row({ token: TOKEN }), WETH).isWeth).toBe(false);
    expect(bucketFromApiRow(row({ token: WETH.toUpperCase() }), WETH).isWeth).toBe(true);
    const b = bucketFromApiRow(row({ claimable: "42" }), WETH);
    expect(b.claimable).toBe("42");
    expect(b.vault).toBe(VAULT);
  });

  it("hides zero-balance buckets", () => {
    expect(hasClaimable(bucketFromApiRow(row({ claimable: "0" }), WETH))).toBe(false);
    expect(hasClaimable(bucketFromApiRow(row({ claimable: "1" }), WETH))).toBe(true);
  });

  it("orders the aggregated WETH leg first, then launch-token legs", () => {
    const rows = [
      bucketFromApiRow(row({ token: TOKEN }), WETH),
      bucketFromApiRow(row({ token: WETH }), WETH),
    ];
    const sorted = sortBuckets(rows);
    expect(sorted[0]?.isWeth).toBe(true);
    expect(sorted[1]?.isWeth).toBe(false);
  });
});
