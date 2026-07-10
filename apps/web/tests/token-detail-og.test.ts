import { afterEach, describe, expect, it, vi } from "vitest";

import { tokenDetail } from "./fixtures";

/**
 * Per-token OG + SSR metadata (§5.2/§9). The `og:image` now points at the
 * API-served, R2-cached PNG (`{API_ORIGIN}/v1/og/{address}.png`) — the web no
 * longer renders OG images itself (dropping `@vercel/og`/resvg-WASM from the
 * Cloudflare Worker bundle to fit the 3 MiB Free limit). Here we prove (a) the
 * textual metadata is produced server-side, and (b) `openGraph.images` +
 * `twitter.images` carry the absolute API URL at 1200×630. The full
 * `javaScriptEnabled:false` DOM assertion lives in the Playwright OG scenario
 * (I-5a/b) — this is the unit-level proxy.
 */

const getToken = vi.fn();
vi.mock("@/shared/api", async (importActual) => {
  const actual = await importActual<typeof import("@/shared/api")>();
  return { ...actual, getToken: (...a: unknown[]) => getToken(...a) };
});

afterEach(() => vi.clearAllMocks());

const ADDRESS = "0x00000000000000000000000000000000000000AA";

describe("generateTokenMetadata (SSR, no client JS)", () => {
  it("produces OpenGraph + Twitter summary_large_image metadata", async () => {
    getToken.mockResolvedValue(tokenDetail());
    const { generateTokenMetadata } = await import("@/views/token-detail");
    const meta = await generateTokenMetadata(ADDRESS);
    expect(meta.title).toMatch(/Hoodie Coin \(HOODIE\)/);
    expect(meta.openGraph?.title).toBeTruthy();
    expect((meta.twitter as { card?: string } | null | undefined)?.card).toBe(
      "summary_large_image",
    );
  });

  it("points og:image + twitter image at the API-served PNG (absolute, 1200×630, lowercased address)", async () => {
    getToken.mockResolvedValue(tokenDetail());
    const { generateTokenMetadata } = await import("@/views/token-detail");
    const meta = await generateTokenMetadata(ADDRESS);

    // Absolute API URL — no `next/og` route; address is lowercased.
    const expectedUrl = `https://api.test.invalid/v1/og/${ADDRESS.toLowerCase()}.png`;

    const ogImages = meta.openGraph?.images as
      | Array<{ url: string; width?: number; height?: number }>
      | undefined;
    expect(ogImages).toHaveLength(1);
    const ogImage = ogImages![0]!;
    expect(ogImage.url).toBe(expectedUrl);
    expect(ogImage.width).toBe(1200);
    expect(ogImage.height).toBe(630);

    const twImages = (meta.twitter as { images?: string[] } | null | undefined)?.images;
    expect(twImages).toContain(expectedUrl);
  });

  it("degrades to a not-found title on a 404 without throwing", async () => {
    const { ApiError } = await import("@/shared/api");
    getToken.mockRejectedValue(new ApiError("not_found", "nope", 404));
    const { generateTokenMetadata } = await import("@/views/token-detail");
    const meta = await generateTokenMetadata("0x00000000000000000000000000000000000000ff");
    expect(meta.title).toMatch(/not found/i);
  });
});
