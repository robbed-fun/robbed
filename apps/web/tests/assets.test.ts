import { describe, expect, it } from "vitest";

import { normalizeAssetUrl, publicWalletImageUrl } from "@/shared/lib/assets";

const HASH = "ab".repeat(32);

describe("asset URL normalization", () => {
  it("rewrites legacy localhost object-store URLs to the configured public asset base", () => {
    expect(
      normalizeAssetUrl(
        `http://localhost:4290/robbed-assets/images/${HASH}.webp`,
        "https://api.robbed.fun/v1/assets",
      ),
    ).toBe(`https://api.robbed.fun/v1/assets/images/${HASH}.webp`);
  });

  it("keeps localhost URLs unchanged when the configured base is also local dev", () => {
    const url = `http://localhost:4900/robbed-assets/images/${HASH}.webp`;
    expect(normalizeAssetUrl(url, "http://localhost:4900/robbed-assets")).toBe(url);
  });

  it("only returns HTTPS public URLs for wallet images", () => {
    expect(
      publicWalletImageUrl(
        `http://localhost:4290/robbed-assets/images/${HASH}.webp`,
        "https://api.robbed.fun/v1/assets",
      ),
    ).toBe(`https://api.robbed.fun/v1/assets/images/${HASH}.webp`);
    expect(publicWalletImageUrl(`http://localhost:4290/robbed-assets/images/${HASH}.webp`)).toBe(
      undefined,
    );
    expect(publicWalletImageUrl(`http://192.168.1.4/images/${HASH}.webp`)).toBe(undefined);
  });
});
