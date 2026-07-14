/**
 * M2-11 moderation: visibility state machine + homoglyph
 * impersonation matcher + vendor boot guard.
 */
import { describe, expect, it } from "bun:test";
import { evaluateVisibility } from "../src/moderation/state-machine";
import { foldConfusables, matchImpersonation } from "../src/moderation/impersonation";
import { assertVendorsBootable, stubVendors } from "../src/moderation/vendors";
import type { ImpersonationWatchlist } from "../src/moderation/impersonation";

const T = { hide: 0.95, review: 0.8 };

describe("visibility state machine", () => {
  it("csam short-circuits to hidden regardless of everything else", () => {
    expect(evaluateVisibility({ csam: true, nsfw: 0, impersonation: true }, T)).toEqual({
      visibility: "hidden",
      reason: "csam_match",
    });
  });
  it("vendor outage fails OPEN to pending_review (never blanks the site)", () => {
    expect(evaluateVisibility({ csam: false, nsfw: null, vendorUnavailable: true }, T).visibility).toBe(
      "pending_review",
    );
  });
  it("nsfw >= hide → hidden, >= review → pending_review", () => {
    expect(evaluateVisibility({ csam: false, nsfw: 0.96 }, T).visibility).toBe("hidden");
    expect(evaluateVisibility({ csam: false, nsfw: 0.85 }, T).visibility).toBe("pending_review");
  });
  it("impersonation alone → pending_review (flag, not hide)", () => {
    expect(evaluateVisibility({ csam: false, nsfw: 0.1, impersonation: true }, T).visibility).toBe(
      "pending_review",
    );
  });
  it("clean → visible", () => {
    expect(evaluateVisibility({ csam: false, nsfw: 0.1 }, T).visibility).toBe("visible");
  });
});

describe("impersonation matcher", () => {
  const wl: ImpersonationWatchlist = {
    source: "t",
    capturedAt: "2026-07-10",
    updatedAt: "2026-07-10",
    entries: [
      { ticker: "BTC", category: "top_asset", names: ["Bitcoin"] },
      { ticker: "HOOD", category: "stock_token", names: ["Robinhood"] },
    ],
  };
  it("matches exact ticker (case-insensitive)", () => {
    expect(matchImpersonation("whatever", "btc", wl)).toEqual({ flagged: true, ticker: "BTC" });
  });
  it("matches a name variant on the token name", () => {
    expect(matchImpersonation("Robinhood", "XYZ", wl).flagged).toBe(true);
  });
  it("folds Cyrillic homoglyphs (е/о/с → e/o/c)", () => {
    // "ВТС" using Cyrillic В Т С folds toward btc-ish; use cyrillic o in hood.
    expect(foldConfusables("HＯOD")).toBe("hood"); // fullwidth O
    expect(matchImpersonation("x", "HOОD", wl).flagged).toBe(true); // cyrillic О
  });
  it("does not flag an unrelated token", () => {
    expect(matchImpersonation("Doge Coin", "DOGE", wl).flagged).toBe(false);
  });
});

describe("vendor boot guard", () => {
  it("throws when stubs run in production without the escape hatch", () => {
    expect(() => assertVendorsBootable(stubVendors(), "production", false)).toThrow();
  });
  it("permits stubs in production with MODERATION_ALLOW_STUBS", () => {
    expect(() => assertVendorsBootable(stubVendors(), "production", true)).not.toThrow();
  });
  it("permits stubs outside production", () => {
    expect(() => assertVendorsBootable(stubVendors(), "development", false)).not.toThrow();
  });
});
