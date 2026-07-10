import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { tokenDetail } from "./fixtures";

/**
 * Per-token OG + SSR metadata (§5.2/§9). The `og:image` tags auto-wire from the
 * `opengraph-image.tsx` file convention (M3-8), so a crawler with JS disabled
 * receives them in the server-rendered <head>. Here we prove (a) the textual
 * metadata is produced server-side, and (b) the opengraph-image route file is
 * present in the segment (its presence is what makes Next emit `og:image`). The
 * full `javaScriptEnabled:false` DOM assertion lives in the Playwright OG
 * scenario (I-5a/b) — this is the unit-level proxy.
 */

const getToken = vi.fn();
vi.mock("@/shared/api", async (importActual) => {
  const actual = await importActual<typeof import("@/shared/api")>();
  return { ...actual, getToken: (...a: unknown[]) => getToken(...a) };
});

afterEach(() => vi.clearAllMocks());

describe("generateTokenMetadata (SSR, no client JS)", () => {
  it("produces OpenGraph + Twitter summary_large_image metadata", async () => {
    getToken.mockResolvedValue(tokenDetail());
    const { generateTokenMetadata } = await import("@/views/token-detail");
    const meta = await generateTokenMetadata("0x00000000000000000000000000000000000000aa");
    expect(meta.title).toMatch(/Hoodie Coin \(HOODIE\)/);
    expect(meta.openGraph?.title).toBeTruthy();
    expect((meta.twitter as { card?: string } | null | undefined)?.card).toBe(
      "summary_large_image",
    );
  });

  it("degrades to a not-found title on a 404 without throwing", async () => {
    const { ApiError } = await import("@/shared/api");
    getToken.mockRejectedValue(new ApiError("not_found", "nope", 404));
    const { generateTokenMetadata } = await import("@/views/token-detail");
    const meta = await generateTokenMetadata("0x00000000000000000000000000000000000000ff");
    expect(meta.title).toMatch(/not found/i);
  });
});

describe("og:image auto-wiring (file convention)", () => {
  it("the Token Detail segment ships an opengraph-image route", () => {
    const p = fileURLToPath(
      new URL("../app/t/[address]/opengraph-image.tsx", import.meta.url),
    );
    expect(existsSync(p)).toBe(true);
  });
});
