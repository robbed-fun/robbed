import { beforeEach, describe, expect, it, vi } from "vitest";

import { OG_FONTS, renderOgPng, sparklineSvg } from "@/shared/lib/og";
import type { TokenOgData } from "@/widgets/token-og";
import { buildTokenOgCard } from "@/widgets/token-og";

/**
 * M3-8 proof (web.md §6): the OG pipeline (next/og `ImageResponse` — satori →
 * resvg-WASM, the workerd-safe backend) returns an `image/png` at exactly
 * 1200×630, for both the pre-grad and graduated cards,
 * and unknown tokens degrade to a 404 (null) with no thrown error.
 */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Parse width/height from a PNG's IHDR chunk (offsets 16/20, big-endian). */
function readPngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_MAGIC.every((b, i) => bytes[i] === b);
}

function ogData(over: Partial<TokenOgData> = {}): TokenOgData {
  return {
    name: "Hoodie Coin",
    ticker: "HOODIE",
    imageDataUri: null, // monogram path — offline-safe, no network in unit test
    status: "curve",
    graduated: false,
    progressPct: 42.5,
    sparkline: [0.001, 0.0012, 0.0011, 0.0015, 0.0014, 0.0019, 0.0021],
    mcapEth: "3.5789",
    mcapUsd: { text: "$12,345", asOf: "2026-07-10T00:00:00Z" },
    ...over,
  };
}

describe("OG image render (M3-8)", () => {
  it("renders a 1200×630 PNG for a pre-grad token", async () => {
    const png = await renderOgPng(buildTokenOgCard(ogData()), { fonts: OG_FONTS });
    expect(isPng(png)).toBe(true);
    expect(readPngSize(png)).toEqual({ width: 1200, height: 630 });
  });

  it("renders a 1200×630 PNG for a graduated token (band variant)", async () => {
    const png = await renderOgPng(
      buildTokenOgCard(ogData({ graduated: true, status: "graduated", progressPct: 100 })),
      { fonts: OG_FONTS },
    );
    expect(isPng(png)).toBe(true);
    expect(readPngSize(png)).toEqual({ width: 1200, height: 630 });
  });

  it("renders a 1200×630 PNG for a token with no trades yet (flat sparkline, null mcap)", async () => {
    const png = await renderOgPng(
      buildTokenOgCard(ogData({ sparkline: [], mcapEth: null, mcapUsd: null })),
      { fonts: OG_FONTS },
    );
    expect(isPng(png)).toBe(true);
    expect(readPngSize(png)).toEqual({ width: 1200, height: 630 });
  });

  it("sparklineSvg emits a valid SVG document sized to request", () => {
    const svg = sparklineSvg([1, 2, 3], { width: 400, height: 100, stroke: "#fff", fill: "#fff" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="400"');
    expect(svg).toContain("polyline");
  });
});

// The data/orchestration layer is mocked at the api boundary so unit tests stay
// hermetic (no indexer, no network). ApiError stays REAL for the instanceof gate.
vi.mock("@/shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api")>();
  return { ...actual, getToken: vi.fn(), getCandles: vi.fn() };
});

describe("renderTokenOgImage orchestration (M3-8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null (→ route 404) for an unknown token", async () => {
    const { ApiError, getToken } = await import("@/shared/api");
    const { renderTokenOgImage } = await import("@/widgets/token-og");
    vi.mocked(getToken).mockRejectedValueOnce(
      new ApiError("not_found", "no such token", 404),
    );
    await expect(renderTokenOgImage("0x" + "a".repeat(40))).resolves.toBeNull();
  });

  it("re-throws non-404 API failures (never ships a wrong image)", async () => {
    const { ApiError, getToken } = await import("@/shared/api");
    const { renderTokenOgImage } = await import("@/widgets/token-og");
    vi.mocked(getToken).mockRejectedValueOnce(
      new ApiError("internal", "boom", 500),
    );
    await expect(renderTokenOgImage("0x" + "b".repeat(40))).rejects.toThrow("boom");
  });

  it("renders a 1200×630 PNG end-to-end when the token exists", async () => {
    const { getToken, getCandles } = await import("@/shared/api");
    const { renderTokenOgImage } = await import("@/widgets/token-og");
    const address = "0x" + "c".repeat(40);

    // Minimal TokenDetail-shaped object covering only the fields the OG reads.
    vi.mocked(getToken).mockResolvedValueOnce({
      name: "Test Token",
      ticker: "TEST",
      imageUrl: null,
      status: "curve",
      graduated: false,
      graduation: { thresholdEth: "10000000000000000000", progressPct: 63.2 },
      mcap: { usd: "50000", ethUsd: "3450", asOf: "2026-07-10T00:00:00Z" },
    } as never);
    vi.mocked(getCandles).mockResolvedValueOnce({
      candles: [0.001, 0.0013, 0.0012, 0.0016].map((close, i) => ({
        bucketStart: 1_700_000_000 + i * 900,
        open: close,
        high: close,
        low: close,
        close,
        volumeEth: "0",
        volumeToken: "0",
        tradeCount: 1,
      })),
    } as never);

    const png = await renderTokenOgImage(address);
    expect(png).not.toBeNull();
    expect(isPng(png!)).toBe(true);
    expect(readPngSize(png!)).toEqual({ width: 1200, height: 630 });
  });
});
