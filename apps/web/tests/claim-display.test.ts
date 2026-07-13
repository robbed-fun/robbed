import { describe, expect, it } from "vitest";

import type { ClaimState } from "@/entities/creator";
import { confirmationBadgeMeta } from "@/entities/trade";
import { claimDisplayState } from "@/widgets/creator-earnings/ui/CreatorEarningsPanel";

/**
 * Creator-fee CLAIM confirmation-tier mapping (§7/§12.63 · §2.1/§12.56). The claim
 * reuses the shared trade confirmation tiers via `ConfirmationBadge`; this proves
 * the mapping NEVER surfaces a settlement tier while soft-confirmed, matching the
 * trade rule (a just-mined claim shows NO chip until the watermark advances).
 */

const base: ClaimState = {
  phase: "idle",
  txHash: null,
  blockNumber: null,
  confirmationState: null,
  error: null,
};

describe("claimDisplayState", () => {
  it("idle → no badge", () => {
    expect(claimDisplayState(base)).toBeNull();
  });

  it("signing → submitting", () => {
    expect(claimDisplayState({ ...base, phase: "signing" })).toBe("submitted");
  });

  it("pending → optimistic pending", () => {
    expect(claimDisplayState({ ...base, phase: "pending" })).toBe("optimistic:pending");
  });

  it("confirmed + soft_confirmed → soft-confirmed AND renders NO settlement chip", () => {
    const s = claimDisplayState({
      ...base,
      phase: "confirmed",
      blockNumber: 10,
      confirmationState: "soft_confirmed",
    });
    expect(s).toBe("indexed:soft-confirmed");
    // The hard invariant (never-final-while-soft): no badge is surfaced yet.
    expect(confirmationBadgeMeta(s!)).toBeNull();
  });

  it("confirmed + posted_to_l1 → posted", () => {
    expect(
      claimDisplayState({ ...base, phase: "confirmed", blockNumber: 10, confirmationState: "posted_to_l1" }),
    ).toBe("indexed:posted-to-l1");
  });

  it("confirmed + finalized → finalized", () => {
    expect(
      claimDisplayState({ ...base, phase: "confirmed", blockNumber: 10, confirmationState: "finalized" }),
    ).toBe("indexed:finalized");
  });

  it("confirmed before any watermark (null tier) → still only soft-confirmed, no chip", () => {
    const s = claimDisplayState({ ...base, phase: "confirmed", blockNumber: 10 });
    expect(s).toBe("optimistic:soft-confirmed");
    expect(confirmationBadgeMeta(s!)).toBeNull();
  });

  it("error → failed", () => {
    expect(claimDisplayState({ ...base, phase: "error", error: "x" })).toBe("failed");
  });
});
