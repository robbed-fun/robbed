/** Confirmation-state enum + transition helpers (indexer.md). */
import { describe, expect, it } from "bun:test";
import {
  CONFIRMATION_STATES,
  compareConfirmationStates,
  confirmationStateSchema,
  isAtLeast,
  stateForBlock,
  upgradeConfirmationState,
} from "../src/confirmation";

describe("wire values (snake_case)", () => {
  it("has exactly the three ratified states in order", () => {
    expect(CONFIRMATION_STATES).toEqual(["soft_confirmed", "posted_to_l1", "finalized"]);
  });

  it("schema accepts wire values and rejects anything else", () => {
    for (const s of CONFIRMATION_STATES) {
      expect(confirmationStateSchema.safeParse(s).success).toBe(true);
    }
    expect(confirmationStateSchema.safeParse("softConfirmed").success).toBe(false);
    expect(confirmationStateSchema.safeParse("posted").success).toBe(false);
    expect(confirmationStateSchema.safeParse("").success).toBe(false);
  });
});

describe("ordering helpers", () => {
  it("orders soft_confirmed < posted_to_l1 < finalized", () => {
    expect(compareConfirmationStates("soft_confirmed", "posted_to_l1")).toBeLessThan(0);
    expect(compareConfirmationStates("posted_to_l1", "finalized")).toBeLessThan(0);
    expect(compareConfirmationStates("finalized", "soft_confirmed")).toBeGreaterThan(0);
    expect(compareConfirmationStates("posted_to_l1", "posted_to_l1")).toBe(0);
  });

  it("isAtLeast", () => {
    expect(isAtLeast("finalized", "posted_to_l1")).toBe(true);
    expect(isAtLeast("posted_to_l1", "posted_to_l1")).toBe(true);
    expect(isAtLeast("soft_confirmed", "posted_to_l1")).toBe(false);
  });

  it("upgrade is monotonic — never downgrades (indexer.md)", () => {
    expect(upgradeConfirmationState("soft_confirmed", "posted_to_l1")).toBe("posted_to_l1");
    expect(upgradeConfirmationState("finalized", "soft_confirmed")).toBe("finalized");
    expect(upgradeConfirmationState("posted_to_l1", "posted_to_l1")).toBe("posted_to_l1");
  });
});

describe("stateForBlock (authoritative rule, indexer.md)", () => {
  const wm = { safeBlock: 1000, finalizedBlock: 500 };

  it("classifies below / between / above watermarks", () => {
    expect(stateForBlock(499, wm)).toBe("finalized");
    expect(stateForBlock(750, wm)).toBe("posted_to_l1");
    expect(stateForBlock(1001, wm)).toBe("soft_confirmed");
  });

  it("event exactly at a watermark block is included (<=)", () => {
    expect(stateForBlock(500, wm)).toBe("finalized");
    expect(stateForBlock(1000, wm)).toBe("posted_to_l1");
  });

  it("accepts bigint block numbers and watermarks", () => {
    expect(stateForBlock(500n, { safeBlock: 1000n, finalizedBlock: 500n })).toBe("finalized");
    expect(stateForBlock(10n ** 15n, wm)).toBe("soft_confirmed");
  });

  it("watermark advance only ever upgrades a fixed block's state (monotonicity)", () => {
    const block = 800;
    const s1 = stateForBlock(block, { safeBlock: 700, finalizedBlock: 100 }); // soft
    const s2 = stateForBlock(block, { safeBlock: 900, finalizedBlock: 100 }); // posted
    const s3 = stateForBlock(block, { safeBlock: 1200, finalizedBlock: 900 }); // finalized
    expect(s1).toBe("soft_confirmed");
    expect(s2).toBe("posted_to_l1");
    expect(s3).toBe("finalized");
    expect(compareConfirmationStates(s2, s1)).toBeGreaterThan(0);
    expect(compareConfirmationStates(s3, s2)).toBeGreaterThan(0);
  });
});
