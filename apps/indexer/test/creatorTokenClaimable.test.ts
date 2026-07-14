/**
 * Post-graduation 50/50 split roll-up — PURE ledger math.
 * Deposit is the ACCRUED source (concrete per-(creator, token) ERC20 amount), claim
 * reduces claimable + stamps last_claim_at, the claimable floor, and the raw pool
 * ordering → token/weth leg resolution (sign pinned by test, not prose).
 */
import { describe, expect, it } from "bun:test";
import {
  applyClaim,
  applyDeposit,
  resolveSplitLegs,
  updateColumns,
} from "../src/creatorTokenClaimable";
import { isoFromUnix } from "../src/creatorClaimable";

const CREATOR = "0x" + "a1".repeat(20);
const TOKEN = "0x" + "cc".repeat(20); // a graduated launch token
const WETH = "0x" + "ee".repeat(20);
const VAULT = "0x" + "b2".repeat(20);
const TS = 1_700_000_000n;

describe("applyDeposit — CreatorTokenDeposited is the accrued source", () => {
  it("creates the row and credits accrued (prev = null)", () => {
    const s = applyDeposit(null, CREATOR, TOKEN, VAULT, 100n, TS);
    expect(s.creator).toBe(CREATOR);
    expect(s.token).toBe(TOKEN);
    expect(s.vault).toBe(VAULT);
    expect(s.totalAccrued).toBe(100n);
    expect(s.totalClaimed).toBe(0n);
    expect(s.claimable).toBe(100n);
    expect(s.lastClaimAt).toBeNull();
    expect(s.updatedAt).toBe(isoFromUnix(TS));
  });

  it("accumulates accrued across deposits for the same (creator, token)", () => {
    const s1 = applyDeposit(null, CREATOR, TOKEN, VAULT, 100n, TS);
    const s2 = applyDeposit(s1, CREATOR, TOKEN, VAULT, 40n, TS + 10n);
    expect(s2.totalAccrued).toBe(140n);
    expect(s2.claimable).toBe(140n);
  });
});

describe("applyClaim — CreatorTokenClaimed reduces claimable", () => {
  it("debits claimed, stamps last_claim_at, floors claimable at 0", () => {
    const accrued = applyDeposit(null, CREATOR, TOKEN, VAULT, 100n, TS);
    const claimed = applyClaim(accrued, CREATOR, TOKEN, VAULT, 100n, TS + 5n);
    expect(claimed.totalAccrued).toBe(100n); // accrued unchanged
    expect(claimed.totalClaimed).toBe(100n);
    expect(claimed.claimable).toBe(0n); // fully claimed
    expect(claimed.lastClaimAt).toBe(TS + 5n);
  });

  it("partial claim leaves the remainder claimable", () => {
    const accrued = applyDeposit(null, CREATOR, TOKEN, VAULT, 100n, TS);
    const claimed = applyClaim(accrued, CREATOR, TOKEN, VAULT, 30n, TS + 5n);
    expect(claimed.claimable).toBe(70n);
  });

  it("keeps the vault from the prior row when present (a claim never redefines custody)", () => {
    const accrued = applyDeposit(null, CREATOR, TOKEN, VAULT, 100n, TS);
    const claimed = applyClaim(accrued, CREATOR, TOKEN, "0x" + "99".repeat(20), 10n, TS + 5n);
    expect(claimed.vault).toBe(VAULT);
  });

  it("floors when claimed > accrued (defensive)", () => {
    const s = applyClaim(null, CREATOR, TOKEN, VAULT, 50n, TS);
    expect(s.totalClaimed).toBe(50n);
    expect(s.claimable).toBe(0n);
  });
});

describe("updateColumns — non-PK columns only ((creator, token) is the PK)", () => {
  it("omits creator + token, includes the rest", () => {
    const s = applyDeposit(null, CREATOR, TOKEN, VAULT, 100n, TS);
    const cols = updateColumns(s);
    expect(cols).not.toHaveProperty("creator");
    expect(cols).not.toHaveProperty("token");
    expect(cols).toEqual({
      vault: VAULT,
      totalAccrued: 100n,
      totalClaimed: 0n,
      claimable: 100n,
      lastClaimAt: null,
      updatedAt: isoFromUnix(TS),
    });
  });
});

describe("resolveSplitLegs — raw pool ordering → token/weth (X-2 orientation)", () => {
  const legs = { treasury0: 10n, creator0: 11n, treasury1: 20n, creator1: 21n };

  it("token is token0 → leg0 = token, leg1 = weth", () => {
    expect(resolveSplitLegs(true, legs)).toEqual({
      creatorAmountToken: 11n, // creator0
      creatorAmountWeth: 21n, // creator1
      treasuryAmountToken: 10n, // treasury0
      treasuryAmountWeth: 20n, // treasury1
    });
  });

  it("token is token1 → the mapping flips (leg1 = token, leg0 = weth)", () => {
    expect(resolveSplitLegs(false, legs)).toEqual({
      creatorAmountToken: 21n, // creator1
      creatorAmountWeth: 11n, // creator0
      treasuryAmountToken: 20n, // treasury1
      treasuryAmountWeth: 10n, // treasury0
    });
  });
});

describe("end-to-end: deposit → claim mirrors tokenBalanceOf semantics", () => {
  it("claimable == Σdeposit − Σclaim (== live tokenBalanceOf), per (creator, token)", () => {
    let s = applyDeposit(null, CREATOR, TOKEN, VAULT, 100n, TS);
    s = applyDeposit(s, CREATOR, TOKEN, VAULT, 50n, TS + 1n); // accrued 150
    s = applyClaim(s, CREATOR, TOKEN, VAULT, 60n, TS + 2n); // claimed 60
    expect(s.totalAccrued).toBe(150n);
    expect(s.totalClaimed).toBe(60n);
    expect(s.claimable).toBe(90n);
  });

  it("a WETH leg aggregates independently of the launch-token leg (separate rows)", () => {
    const tokenLeg = applyDeposit(null, CREATOR, TOKEN, VAULT, 100n, TS);
    const wethLeg = applyDeposit(null, CREATOR, WETH, VAULT, 7n, TS);
    expect(tokenLeg.token).toBe(TOKEN);
    expect(tokenLeg.claimable).toBe(100n);
    expect(wethLeg.token).toBe(WETH);
    expect(wethLeg.claimable).toBe(7n);
  });
});
