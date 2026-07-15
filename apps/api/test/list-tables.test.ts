/**
 * server-side sorted + keyset-paginated TRADES and HOLDERS endpoints
 * (route level, through the real projections + FakeDb keyset mirror): each valid
 * sort field orders correctly, out-of-allowlist ⇒ 400, keyset walks all pages with
 * no dup/skip under every sort, defaults hold, HolderRow.rank is the true balance
 * rank even under a non-balance sort, and the wire is the `{ items, nextCursor }`
 * envelope.
 */
import { describe, expect, it } from "bun:test";
import { paginatedHoldersResponseSchema, paginatedTradesResponseSchema } from "@robbed/shared";
import { createApp } from "../src/app";
import {
  FakeDb,
  TEST_ADDR,
  TEST_CREATOR,
  TEST_CURVE,
  fixtureHolder,
  fixtureToken,
  fixtureTrade,
  makeTestDeps,
  readJson,
} from "./helpers";

// ── trade fixtures: distinct amount / price / age / trader / side ───────────
const TRADES = [
  fixtureTrade({ id: "t-0", trader: "0x" + "a1".repeat(20), is_buy: true, eth_amount: "3", price_eth: 3e-8, block_timestamp: 1000, block_number: 100 }),
  fixtureTrade({ id: "t-1", trader: "0x" + "b2".repeat(20), is_buy: false, eth_amount: "1", price_eth: 1e-8, block_timestamp: 1002, block_number: 102 }),
  fixtureTrade({ id: "t-2", trader: "0x" + "c3".repeat(20), is_buy: true, eth_amount: "5", price_eth: 5e-8, block_timestamp: 1001, block_number: 101 }),
  fixtureTrade({ id: "t-3", trader: "0x" + "d4".repeat(20), is_buy: false, eth_amount: "2", price_eth: 2e-8, block_timestamp: 1004, block_number: 104 }),
  fixtureTrade({ id: "t-4", trader: "0x" + "e5".repeat(20), is_buy: true, eth_amount: "4", price_eth: 4e-8, block_timestamp: 1003, block_number: 103 }),
];

// ── holder fixtures: distinct balances + one of each role ────────────────────
const FLAGGED = "0x" + "f1".repeat(20);
const REG1 = "0x" + "a1".repeat(20);
const REG2 = "0x" + "b2".repeat(20);
const HOLDERS = [
  fixtureHolder({ holder: REG1, balance: "500" }),
  fixtureHolder({ holder: TEST_CREATOR, balance: "400" }),
  fixtureHolder({ holder: FLAGGED, balance: "300", flags: { flags: ["sniper"], cluster_id: "c1" } }),
  fixtureHolder({ holder: REG2, balance: "200" }),
  fixtureHolder({ holder: TEST_CURVE, balance: "100" }),
];

function tradesApp() {
  const db = new FakeDb([fixtureToken()]);
  db.tokenTrades = TRADES;
  return createApp(makeTestDeps({ db }));
}
function holdersApp() {
  const db = new FakeDb([fixtureToken()]);
  db.tokenHolders = HOLDERS;
  return createApp(makeTestDeps({ db }));
}
const get = (app: ReturnType<typeof createApp>, url: string) =>
  app.request(new Request(`http://x${url}`));

/** Follow nextCursor to the end; return the flattened item list. */
async function collectAll<T>(
  app: ReturnType<typeof createApp>,
  base: string,
  pick: (data: { items: T[]; nextCursor: string | null }) => T[],
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    const sep = base.includes("?") ? "&" : "?";
    const url = `${base}${cursor ? `${sep}cursor=${encodeURIComponent(cursor)}` : ""}`;
    const data = (await readJson(await get(app, url))).data as { items: T[]; nextCursor: string | null };
    out.push(...pick(data));
    if (!data.nextCursor) break;
    cursor = data.nextCursor;
  }
  return out;
}

describe("GET /v1/tokens/:address/trades — sort + keyset ", () => {
  const app = tradesApp();
  const url = (q = "") => `/v1/tokens/${TEST_ADDR}/trades${q}`;

  it("default is age DESC (newest-first) with the {items,nextCursor} envelope", async () => {
    const data = (await readJson(await get(app, url()))).data;
    expect(() => paginatedTradesResponseSchema.parse(data)).not.toThrow();
    expect(data.items.map((r: { blockTimestamp: number }) => r.blockTimestamp)).toEqual([
      1004, 1003, 1002, 1001, 1000,
    ]);
    expect(data.nextCursor).toBeNull(); // 5 rows < default limit
  });

  it("sort=amount orders by ETH notional (desc and asc)", async () => {
    const desc = (await readJson(await get(app, url("?sort=amount&dir=desc")))).data;
    expect(desc.items.map((r: { ethAmount: string }) => r.ethAmount)).toEqual(["5", "4", "3", "2", "1"]);
    const asc = (await readJson(await get(app, url("?sort=amount&dir=asc")))).data;
    expect(asc.items.map((r: { ethAmount: string }) => r.ethAmount)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("sort=price orders by per-trade price desc", async () => {
    const data = (await readJson(await get(app, url("?sort=price&dir=desc")))).data;
    expect(data.items.map((r: { priceEth: number }) => r.priceEth)).toEqual([5e-8, 4e-8, 3e-8, 2e-8, 1e-8]);
  });

  it("sort=trader orders by address asc", async () => {
    const data = (await readJson(await get(app, url("?sort=trader&dir=asc")))).data;
    const traders = data.items.map((r: { trader: string }) => r.trader);
    expect(traders).toEqual([...traders].sort());
  });

  it("sort=side groups buys/sells (desc = buys first)", async () => {
    const data = (await readJson(await get(app, url("?sort=side&dir=desc")))).data;
    const sides = data.items.map((r: { isBuy: boolean }) => r.isBuy);
    expect(sides).toEqual([true, true, true, false, false]);
  });

  it("out-of-allowlist sort ⇒ 400, bad dir ⇒ 400 (the ORDER BY boundary)", async () => {
    const bad = await get(app, url("?sort=xyz"));
    expect(bad.status).toBe(400);
    expect((await readJson(bad)).error.code).toBe("invalid_request");
    const injected = await get(app, url("?sort=eth_amount;DROP TABLE trades"));
    expect(injected.status).toBe(400);
    const badDir = await get(app, url("?sort=amount&dir=up"));
    expect(badDir.status).toBe(400);
  });

  it("keyset walks every page with no dup/skip, matching the single-page order", async () => {
    for (const q of ["?sort=amount&dir=desc", "?sort=age&dir=desc", "?sort=trader&dir=asc"]) {
      const full = (await readJson(await get(app, url(q)))).data.items.map((r: { id: string }) => r.id);
      const paged = (
        await collectAll<{ id: string }>(app, url(`${q}&limit=2`), (d) => d.items)
      ).map((r) => r.id);
      expect(paged).toEqual(full);
      expect(new Set(paged).size).toBe(paged.length); // no duplicates
    }
  });

  it("404 for an unknown token", async () => {
    const res = await get(app, `/v1/tokens/0x9999999999999999999999999999999999999999/trades`);
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/tokens/:address/holders — sort + keyset + rank ", () => {
  const app = holdersApp();
  const url = (q = "") => `/v1/tokens/${TEST_ADDR}/holders${q}`;

  it("default is balance DESC; rank == page position on the default page; envelope shape", async () => {
    const data = (await readJson(await get(app, url()))).data;
    expect(() => paginatedHoldersResponseSchema.parse(data)).not.toThrow();
    expect(data.items.map((r: { balance: string }) => r.balance)).toEqual(["500", "400", "300", "200", "100"]);
    expect(data.items.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(data.nextCursor).toBeNull();
  });

  it("sort=percent&dir=desc ≡ balance desc (the live-check query)", async () => {
    const data = (await readJson(await get(app, url("?sort=percent&dir=desc")))).data;
    expect(data.items.map((r: { balance: string }) => r.balance)).toEqual(["500", "400", "300", "200", "100"]);
  });

  it("sort=amount&dir=asc reverses to smallest-first", async () => {
    const data = (await readJson(await get(app, url("?sort=amount&dir=asc")))).data;
    expect(data.items.map((r: { balance: string }) => r.balance)).toEqual(["100", "200", "300", "400", "500"]);
  });

  it("sort=address carries the TRUE balance rank (position ≠ rank)", async () => {
    const data = (await readJson(await get(app, url("?sort=address&dir=asc")))).data;
    const addrs = data.items.map((r: { address: string }) => r.address);
    expect(addrs).toEqual([...addrs].sort()); // page ordered by holder asc
    // rank stays the balance-desc rank: creator(400→2), curve(100→5), reg1(500→1),
    // reg2(200→4), flagged(300→3) — in the holder-asc page order 0x22,0x33,0xa1,0xb2,0xf1.
    expect(data.items.map((r: { rank: number }) => r.rank)).toEqual([2, 5, 1, 4, 3]);
  });

  it("sort=label orders protocol roles → unlabeled by address", async () => {
    const data = (await readJson(await get(app, url("?sort=label&dir=asc")))).data;
    const items = data.items as { address: string; flags: string[]; botFlags?: string[] }[];
    expect(items.map((r) => r.address)).toEqual([TEST_CURVE, TEST_CREATOR, REG1, REG2, FLAGGED]);
    // Bot flags stay on the wire, but they no longer affect the public label sort.
    expect(items[4]?.botFlags).toEqual(["sniper"]);
  });

  it("out-of-allowlist sort ⇒ 400 (physical column name is NOT a field label)", async () => {
    const bad = await get(app, url("?sort=balance"));
    expect(bad.status).toBe(400);
    expect((await readJson(bad)).error.code).toBe("invalid_request");
    expect((await get(app, url("?sort=holder"))).status).toBe(400);
  });

  it("keyset walks every page with no dup/skip; rank preserved across pages", async () => {
    for (const q of ["?sort=amount&dir=desc", "?sort=address&dir=asc", "?sort=label&dir=asc"]) {
      const full = (await readJson(await get(app, url(q)))).data.items as { address: string; rank: number }[];
      const paged = await collectAll<{ address: string; rank: number }>(app, url(`${q}&limit=2`), (d) => d.items);
      expect(paged.map((r) => r.address)).toEqual(full.map((r) => r.address));
      expect(paged.map((r) => r.rank)).toEqual(full.map((r) => r.rank));
      expect(new Set(paged.map((r) => r.address)).size).toBe(paged.length);
    }
  });

  it("404 for an unknown token", async () => {
    const res = await get(app, `/v1/tokens/0x9999999999999999999999999999999999999999/holders`);
    expect(res.status).toBe(404);
  });
});
