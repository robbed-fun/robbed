/**
 * Creator-fee claimable roll-up — PURE ledger math.
 * Accrual (sweep), claim reduces claimable, deposit corroborates the vault
 * without double-counting, and the claimable floor.
 */
import { describe, expect, it } from "bun:test";
import {
  applyClaim,
  applyDeposit,
  applySweep,
  computeClaimable,
  isoFromUnix,
} from "../src/creatorClaimable";

const CREATOR = "0x" + "a1".repeat(20);
const VAULT = "0x" + "b2".repeat(20);
const TS = 1_700_000_000n;

describe("computeClaimable — accrued − claimed, floored at 0", () => {
  it("returns the positive difference", () => expect(computeClaimable(100n, 30n)).toBe(70n));
  it("floors at 0 when claimed ≥ accrued (defensive)", () => expect(computeClaimable(30n, 100n)).toBe(0n));
  it("is 0 at parity", () => expect(computeClaimable(50n, 50n)).toBe(0n));
});

describe("applySweep — CreatorFeesSwept is the accrued source", () => {
  it("creates the row and credits accrued (prev = null)", () => {
    const s = applySweep(null, CREATOR, VAULT, 100n, TS);
    expect(s.creator).toBe(CREATOR);
    expect(s.vault).toBe(VAULT);
    expect(s.totalAccruedEth).toBe(100n);
    expect(s.totalClaimedEth).toBe(0n);
    expect(s.claimableEth).toBe(100n);
    expect(s.lastClaimAt).toBeNull();
    expect(s.updatedAt).toBe(isoFromUnix(TS));
  });

  it("accumulates accrued across sweeps", () => {
    const s1 = applySweep(null, CREATOR, VAULT, 100n, TS);
    const s2 = applySweep(s1, CREATOR, VAULT, 40n, TS + 10n);
    expect(s2.totalAccruedEth).toBe(140n);
    expect(s2.claimableEth).toBe(140n);
  });
});

describe("applyClaim — CreatorFeeClaimed reduces claimable", () => {
  it("debits claimed, stamps last_claim_at, floors claimable", () => {
    const accrued = applySweep(null, CREATOR, VAULT, 100n, TS);
    const claimed = applyClaim(accrued, CREATOR, VAULT, 100n, TS + 5n);
    expect(claimed.totalAccruedEth).toBe(100n); // accrued unchanged
    expect(claimed.totalClaimedEth).toBe(100n);
    expect(claimed.claimableEth).toBe(0n); // fully claimed
    expect(claimed.lastClaimAt).toBe(TS + 5n);
  });

  it("partial claim leaves the remainder claimable", () => {
    const accrued = applySweep(null, CREATOR, VAULT, 100n, TS);
    const claimed = applyClaim(accrued, CREATOR, VAULT, 30n, TS + 5n);
    expect(claimed.claimableEth).toBe(70n);
  });

  it("keeps the vault from the prior row when present", () => {
    const accrued = applySweep(null, CREATOR, VAULT, 100n, TS);
    const claimed = applyClaim(accrued, CREATOR, "0x" + "cc".repeat(20), 10n, TS + 5n);
    expect(claimed.vault).toBe(VAULT); // prev vault wins
  });
});

describe("applyDeposit — vault corroboration, NEVER double-counts accrued", () => {
  it("does not change accrued/claimed (avoids double count with the sweep)", () => {
    const accrued = applySweep(null, CREATOR, VAULT, 100n, TS);
    const afterDeposit = applyDeposit(accrued, CREATOR, VAULT, TS + 1n);
    expect(afterDeposit.totalAccruedEth).toBe(100n); // unchanged — not +100 again
    expect(afterDeposit.claimableEth).toBe(100n);
  });

  it("creates the row + sets the authoritative vault when seen first (same-tx ordering)", () => {
    const s = applyDeposit(null, CREATOR, VAULT, TS);
    expect(s.vault).toBe(VAULT);
    expect(s.totalAccruedEth).toBe(0n);
    expect(s.claimableEth).toBe(0n);
  });
});

describe("end-to-end: accrue → claim mirrors balanceOf semantics", () => {
  it("claimable == Σsweep − Σclaim (== the on-chain balanceOf)", () => {
    let s = applySweep(null, CREATOR, VAULT, 100n, TS);
    s = applySweep(s, CREATOR, VAULT, 50n, TS + 1n); // accrued 150
    s = applyDeposit(s, CREATOR, VAULT, TS + 1n); // corroboration, no change
    s = applyClaim(s, CREATOR, VAULT, 60n, TS + 2n); // claimed 60
    expect(s.totalAccruedEth).toBe(150n);
    expect(s.totalClaimedEth).toBe(60n);
    expect(s.claimableEth).toBe(90n);
  });
});
