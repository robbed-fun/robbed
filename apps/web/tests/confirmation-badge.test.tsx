import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ConfirmationBadge,
  confirmationBadgeMeta,
  createInitialTradesState,
  displayStateForIndexed,
  tradeDisplayState,
  tradesReducer,
} from "@/entities/trade";
import { tradeRow } from "./fixtures";

/**
 * ConfirmationBadge tiers (§2.1). Proves the three tiers, that a soft-confirmed
 * trade NEVER renders as unqualified-final (§2.1.3), and that tiers advance from
 * the O(1) `global:confirmations` WATERMARK — not per-row messages (§12.20).
 */

afterEach(cleanup);

describe("confirmationBadgeMeta — labels + the never-final-while-soft rule", () => {
  it("maps each display node to its tier label", () => {
    expect(confirmationBadgeMeta("optimistic:soft-confirmed")!.label).toBe("Soft-confirmed");
    expect(confirmationBadgeMeta("indexed:soft-confirmed")!.label).toBe("Soft-confirmed");
    expect(confirmationBadgeMeta("indexed:posted-to-l1")!.label).toBe("Posted to L1");
    expect(confirmationBadgeMeta("indexed:finalized")!.label).toBe("Finalized");
    expect(confirmationBadgeMeta("removed")).toBeNull();
  });

  it("a soft-confirmed badge keeps the pulse and never claims a settled tier", () => {
    const soft = confirmationBadgeMeta("optimistic:soft-confirmed")!;
    expect(soft.pulse).toBe(true);
    expect(soft.label).not.toMatch(/final|posted/i);
  });

  it("maps a plain indexed ConfirmationState to its display node", () => {
    expect(displayStateForIndexed("soft_confirmed")).toBe("indexed:soft-confirmed");
    expect(displayStateForIndexed("posted_to_l1")).toBe("indexed:posted-to-l1");
    expect(displayStateForIndexed("finalized")).toBe("indexed:finalized");
  });
});

describe("ConfirmationBadge render — three tiers", () => {
  it("renders each tier's label", () => {
    const { rerender } = render(<ConfirmationBadge state="optimistic:soft-confirmed" />);
    expect(screen.getByText("Soft-confirmed")).toBeTruthy();
    rerender(<ConfirmationBadge state="indexed:posted-to-l1" />);
    expect(screen.getByText("Posted to L1")).toBeTruthy();
    rerender(<ConfirmationBadge state="indexed:finalized" />);
    expect(screen.getByText("Finalized")).toBeTruthy();
  });

  it("a soft-confirmed badge never renders 'Finalized'/'Posted' text", () => {
    render(<ConfirmationBadge state="optimistic:soft-confirmed" />);
    expect(screen.queryByText(/finalized/i)).toBeNull();
    expect(screen.queryByText(/posted/i)).toBeNull();
  });
});

describe("watermark drives tier upgrades on a RECONCILED trade (§12.20)", () => {
  const txHash =
    "0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcab";
  const token = "0x00000000000000000000000000000000000000aa";

  function reconciledAtBlock100() {
    let s = createInitialTradesState({ safeBlock: 0, finalizedBlock: 0 });
    s = tradesReducer(s, {
      type: "submit",
      trade: {
        id: "t1",
        sender: "0x00000000000000000000000000000000000000ee",
        token,
        isBuy: true,
        ethAmount: "500000000000000000",
        tokenAmount: "1200000000000000000000000",
        txHash,
      },
    });
    s = tradesReducer(s, { type: "receipt", id: "t1", status: "success" });
    // Indexed WS trade at block 100 → reconcile.
    s = tradesReducer(s, {
      type: "ws-trade",
      row: { ...tradeRow({ txHash, token, blockNumber: 100 }) },
    });
    return s;
  }

  it("soft-confirmed → posted → finalized as the watermark advances", () => {
    let s = reconciledAtBlock100();
    expect(tradeDisplayState(s.byId.t1!)).toBe("indexed:soft-confirmed");

    s = tradesReducer(s, { type: "watermark", watermarks: { safeBlock: 100, finalizedBlock: 0 } });
    expect(tradeDisplayState(s.byId.t1!)).toBe("indexed:posted-to-l1");
    expect(confirmationBadgeMeta(tradeDisplayState(s.byId.t1!))!.label).toBe("Posted to L1");

    s = tradesReducer(s, { type: "watermark", watermarks: { safeBlock: 100, finalizedBlock: 100 } });
    expect(tradeDisplayState(s.byId.t1!)).toBe("indexed:finalized");
    expect(confirmationBadgeMeta(tradeDisplayState(s.byId.t1!))!.label).toBe("Finalized");
  });

  it("an UN-reconciled optimistic trade stays soft-confirmed even past the watermark", () => {
    let s = createInitialTradesState();
    s = tradesReducer(s, {
      type: "submit",
      trade: {
        id: "t2",
        sender: "0x00000000000000000000000000000000000000ee",
        token,
        isBuy: true,
        ethAmount: "1",
        tokenAmount: "1",
        txHash,
      },
    });
    s = tradesReducer(s, { type: "receipt", id: "t2", status: "success" });
    // Watermark far ahead — but no indexed reconcile yet.
    s = tradesReducer(s, {
      type: "watermark",
      watermarks: { safeBlock: 10_000, finalizedBlock: 10_000 },
    });
    expect(tradeDisplayState(s.byId.t2!)).toBe("optimistic:soft-confirmed");
    expect(confirmationBadgeMeta(tradeDisplayState(s.byId.t2!))!.label).toBe("Soft-confirmed");
  });
});
