/** Frozen constants (CLAUDE.md chain facts). */
import { describe, expect, it } from "bun:test";
import {
  BPS_DENOMINATOR,
  combinedTradeFeeBps,
  CREATOR_LP_SHARE_BPS,
  isCombinedTradeFeeWithinCap,
  LP_COPY,
  MAX_IMAGE_BYTES,
  MAX_METADATA_JSON_BYTES,
  MAX_TRADE_FEE_BPS,
  METADATA_DESCRIPTION_MAX,
  METADATA_NAME_MAX,
  METADATA_TICKER_MAX,
  TOKEN_CARD_DESCRIPTION_MAX,
  UNISWAP_V3,
  WETH_ADDRESS,
} from "../src/constants";
import { utf8ByteLen } from "../src/text";

describe("Uniswap V3 external addresses (source of truth)", () => {
  it("records the four addresses verbatim", () => {
    expect(UNISWAP_V3.factory).toBe("0x1f7d7550B1b028f7571E69A784071F0205FD2EfA");
    expect(UNISWAP_V3.positionManager).toBe("0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3");
    expect(UNISWAP_V3.swapRouter02).toBe("0xcaf681a66d020601342297493863e78c959e5cb2");
    expect(UNISWAP_V3.quoterV2).toBe("0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7");
  });

  it("every address is a non-zero 20-byte hex (indexer startup assertion)", () => {
    for (const a of Object.values(UNISWAP_V3)) {
      expect(a).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(a).not.toBe(`0x${"0".repeat(40)}`);
    }
    expect(WETH_ADDRESS).toBe("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
  });
});

describe("byte-limit maxes + LP copy + size caps ", () => {
  it("name/ticker maxes are the byte counts", () => {
    expect(METADATA_NAME_MAX).toBe(32);
    expect(METADATA_TICKER_MAX).toBe(10);
  });

  it("card description truncation length (D-70) is 160 and below the stored max", () => {
    expect(TOKEN_CARD_DESCRIPTION_MAX).toBe(160);
    // card cap is a projection truncation only — must not exceed the stored/validated max
    expect(TOKEN_CARD_DESCRIPTION_MAX).toBeLessThanOrEqual(METADATA_DESCRIPTION_MAX);
  });

  it("LP_COPY is the exact canonical sentence WITH trailing period", () => {
    // NOT yet flipped to the wording — that lands WITH the creator-fee
    // generation deploy; flipping early mislabels the live treasury-only
    // mainnet copy. Kept as the treasury-only string until Phase-2 relays the deploy.
    expect(LP_COPY).toBe("LP principal permanently locked; trading fees claimable by treasury.");
    expect(LP_COPY.endsWith(".")).toBe(true);
  });

  it("image + metadata JSON caps present", () => {
    expect(MAX_IMAGE_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_METADATA_JSON_BYTES).toBe(64 * 1024);
  });

  it("utf8ByteLen equals Solidity bytes(x).length at the boundaries", () => {
    expect(utf8ByteLen("x".repeat(32))).toBe(32); // 32-byte name boundary
    expect(utf8ByteLen("x".repeat(33))).toBe(33);
    expect(utf8ByteLen("Ü".repeat(5))).toBe(10); // 10-byte ticker boundary (multibyte)
    expect(utf8ByteLen("Ü".repeat(6))).toBe(12);
  });
});

describe("creator-fee split constants + additive cap ", () => {
  it("CREATOR_LP_SHARE_BPS is the 50/50 post-grad split ", () => {
    expect(CREATOR_LP_SHARE_BPS).toBe(5000);
    expect(BPS_DENOMINATOR).toBe(10_000);
    // treasury share is the remaining half — an exact 50/50 split, no rounding gap
    expect(BPS_DENOMINATOR - CREATOR_LP_SHARE_BPS).toBe(CREATOR_LP_SHARE_BPS);
  });

  it("additive cap holds for the mainnet default (100 + 50 = 150 ≤ 200)", () => {
    expect(combinedTradeFeeBps(100, 50)).toBe(150);
    expect(isCombinedTradeFeeWithinCap(100, 50)).toBe(true);
    // boundary: exactly the cap is allowed (exercised by gate-2, never the deploy default)
    expect(isCombinedTradeFeeWithinCap(100, 100)).toBe(true);
    expect(combinedTradeFeeBps(100, 100)).toBe(MAX_TRADE_FEE_BPS);
    // over the cap is rejected by the ONE shared predicate the factory mirrors
    expect(isCombinedTradeFeeWithinCap(150, 100)).toBe(false);
    expect(isCombinedTradeFeeWithinCap(200, 1)).toBe(false);
  });
});
