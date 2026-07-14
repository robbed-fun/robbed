/**
 * OG share-card render + endpoint proof (api.md). Mirrors the
 * frontend's `apps/web/tests/og.test.ts` contract — magic bytes + IHDR
 * 1200×630 — now proving the NATIVE satori + @resvg/resvg-js path that replaced
 * `@vercel/og` on the edge Worker. Also exercises the R2 cache (miss → hit),
 * ETag 304 revalidation, and the 404/400 branches.
 */
import { describe, expect, it } from "bun:test";
import { createApp } from "../src/app";
import { buildTokenOgCard, type TokenOgData } from "../src/og/card";
import { OG_FONTS } from "../src/og/fonts";
import { renderOgPng } from "../src/og/render";
import { FakeDb, TEST_ADDR, fixtureToken, makeTestDeps } from "./helpers";
import type { CandleRow } from "@robbed/shared";

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

function candleFixture(closes: number[]): CandleRow[] {
  return closes.map((close, i) => ({
    token_address: TEST_ADDR,
    interval: "15m",
    bucket_start: 1_700_000_000 + i * 900,
    open: close,
    high: close,
    low: close,
    close,
    volume_eth: "0",
    volume_token: "0",
    trade_count: 1,
    last_block_number: 100 + i,
    last_log_index: 0,
  }));
}

describe("OG render (native satori → resvg)", () => {
  it("renders a 1200×630 PNG for a pre-grad token", async () => {
    const png = await renderOgPng(buildTokenOgCard(ogData()), { fonts: OG_FONTS });
    expect(isPng(png)).toBe(true);
    expect(readPngSize(png)).toEqual({ width: 1200, height: 630 });
  });

  it("renders a 1200×630 PNG for a graduated token", async () => {
    const png = await renderOgPng(
      buildTokenOgCard(ogData({ graduated: true, status: "graduated", progressPct: 100 })),
      { fonts: OG_FONTS },
    );
    expect(isPng(png)).toBe(true);
    expect(readPngSize(png)).toEqual({ width: 1200, height: 630 });
  });

  it("renders a 1200×630 PNG with no trades yet (flat sparkline, null mcap)", async () => {
    const png = await renderOgPng(
      buildTokenOgCard(ogData({ sparkline: [], mcapEth: null, mcapUsd: null })),
      { fonts: OG_FONTS },
    );
    expect(isPng(png)).toBe(true);
    expect(readPngSize(png)).toEqual({ width: 1200, height: 630 });
  });
});

function appWithCandles() {
  const db = new FakeDb([fixtureToken()]);
  db.candles = candleFixture([0.001, 0.0013, 0.0012, 0.0016, 0.0019]);
  return { app: createApp(makeTestDeps({ db })), db };
}

describe("GET /v1/og/:address.png", () => {
  it("returns image/png 1200×630, cache MISS then HIT", async () => {
    const { app } = appWithCandles();

    const miss = await app.request(new Request(`http://x/v1/og/${TEST_ADDR}.png`));
    expect(miss.status).toBe(200);
    expect(miss.headers.get("content-type")).toBe("image/png");
    expect(miss.headers.get("x-robbed-og-cache")).toBe("miss");
    const bytes = new Uint8Array(await miss.arrayBuffer());
    expect(isPng(bytes)).toBe(true);
    expect(readPngSize(bytes)).toEqual({ width: 1200, height: 630 });
    expect(miss.headers.get("cache-control")).toContain("max-age");
    expect(miss.headers.get("etag")).toBeTruthy();

    // Second request for the SAME stats serves stored bytes from R2.
    const hit = await app.request(new Request(`http://x/v1/og/${TEST_ADDR}.png`));
    expect(hit.status).toBe(200);
    expect(hit.headers.get("x-robbed-og-cache")).toBe("hit");
    const hitBytes = new Uint8Array(await hit.arrayBuffer());
    expect(hitBytes).toEqual(bytes);
  });

  it("serves the extensionless form too", async () => {
    const { app } = appWithCandles();
    const res = await app.request(new Request(`http://x/v1/og/${TEST_ADDR}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("304s on matching If-None-Match (no render, no body)", async () => {
    const { app } = appWithCandles();
    const first = await app.request(new Request(`http://x/v1/og/${TEST_ADDR}.png`));
    const etag = first.headers.get("etag")!;
    const res = await app.request(
      new Request(`http://x/v1/og/${TEST_ADDR}.png`, { headers: { "If-None-Match": etag } }),
    );
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(etag);
  });

  it("404s an unknown token", async () => {
    const app = createApp(makeTestDeps({ db: new FakeDb([]) }));
    const res = await app.request(
      new Request(`http://x/v1/og/0x${"9".repeat(40)}.png`),
    );
    expect(res.status).toBe(404);
  });

  it("400s a malformed address", async () => {
    const { app } = appWithCandles();
    const res = await app.request(new Request("http://x/v1/og/not-an-address.png"));
    expect(res.status).toBe(400);
  });
});
