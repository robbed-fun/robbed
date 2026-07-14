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
 * ConfirmationBadge tiers. (USER-DIRECTED) the soft-confirmed tier
 * renders NO visible chip — only posted-to-L1 / finalized surface. Proves the
 * remaining tiers, that a soft-confirmed row shows no settlement badge (so it can
 * never render as unqualified-final), and that the tier MACHINERY is unchanged:
 * the display state still advances from soft-confirmed via the O(1)
 * `global:confirmations` WATERMARK — not per-row messages.
 */

afterEach(cleanup);

describe("confirmationBadgeMeta — surfaced tiers + the removed soft chip ", () => {
  it("renders NO badge for the soft-confirmed tier (chip removed)", () => {
    expect(confirmationBadgeMeta("optimistic:soft-confirmed")).toBeNull();
    expect(confirmationBadgeMeta("indexed:soft-confirmed")).toBeNull();
  });

  it("still labels the surfaced posted/finalized tiers", () => {
    expect(confirmationBadgeMeta("indexed:posted-to-l1")!.label).toBe("Posted to L1");
    expect(confirmationBadgeMeta("indexed:finalized")!.label).toBe("Finalized");
    expect(confirmationBadgeMeta("removed")).toBeNull();
  });

  it("maps a plain indexed ConfirmationState to its display node (machinery intact)", () => {
    expect(displayStateForIndexed("soft_confirmed")).toBe("indexed:soft-confirmed");
    expect(displayStateForIndexed("posted_to_l1")).toBe("indexed:posted-to-l1");
    expect(displayStateForIndexed("finalized")).toBe("indexed:finalized");
  });
});

describe("ConfirmationBadge render — surfaced tiers only", () => {
  it("renders the posted + finalized labels", () => {
    const { rerender } = render(<ConfirmationBadge state="indexed:posted-to-l1" />);
    expect(screen.getByText("Posted to L1")).toBeTruthy();
    rerender(<ConfirmationBadge state="indexed:finalized" />);
    expect(screen.getByText("Finalized")).toBeTruthy();
  });

  it("a soft-confirmed row renders NOTHING (no chip, so never unqualified-final)", () => {
    const { container } = render(<ConfirmationBadge state="optimistic:soft-confirmed" />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByText(/finalized|posted|soft-confirmed/i)).toBeNull();
  });
});

describe("watermark drives tier upgrades on a RECONCILED trade ", () => {
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

  it("an UN-reconciled optimistic trade stays soft-confirmed past the watermark, with no chip", () => {
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
    // Machinery unchanged: the state stays soft-confirmed until an indexed
    // reconcile arrives. that state renders no visible chip.
    expect(tradeDisplayState(s.byId.t2!)).toBe("optimistic:soft-confirmed");
    expect(confirmationBadgeMeta(tradeDisplayState(s.byId.t2!))).toBeNull();
  });
});
