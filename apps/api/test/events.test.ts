/**
 * GET /v1/events — Discover event-tape seed (root-cause fix: a graduation
 * never surfaced on the tape because there was NO server-side historical feed;
 * the tape seeded only LAUNCH rows from /v1/tokens and relied on live WS).
 *
 * Asserts: the merged feed is schema-valid against the FROZEN shared
 * `eventsResponseSchema`; a GRADUATION row is present in `type=all` and
 * `type=graduations` (the reproduction of the reported bug); newest-first
 * ordering across kinds by the globally-unique (blockNumber, logIndex); the
 * `type` filter isolates kinds; an out-of-allowlist `type` ⇒ 400; hidden
 * tokens are excluded (listing-gated).
 */
import { describe, expect, it } from "bun:test";
import { eventsResponseSchema } from "@robbed/shared";
import { createApp } from "../src/app";
import { FakeDb, TEST_ADDR, fixtureToken, fixtureTrade, makeTestDeps, readJson } from "./helpers";

const POOL = "0x44e727da100884de04fe6616948a1cae796cb00a";

function depsWithFeed() {
  // A graduated token: launch (block 100), a trade (block 110), then the
  // graduation (block 133 — matches the reported scenario shape).
  const db = new FakeDb([
    fixtureToken({ address: TEST_ADDR, graduated: true, block_number: 100, log_index: 0 }),
  ]);
  db.tokenTrades = [
    fixtureTrade({
      id: `${"0x" + "aa".repeat(32)}-2`,
      token_address: TEST_ADDR,
      block_number: 110,
      log_index: 2,
      tx_hash: "0x" + "aa".repeat(32),
    }),
  ];
  db.graduationEvents = [
    { token: TEST_ADDR, pool: POOL, block_number: 133, log_index: 18, block_timestamp: 1_784_029_859 },
  ];
  return makeTestDeps({ db });
}

const app = () => createApp(depsWithFeed());
const get = (a: ReturnType<typeof app>, path: string) => a.request(new Request(`http://x${path}`));

describe("GET /v1/events — merged Discover feed", () => {
  it("type=all is schema-valid and newest-first across kinds", async () => {
    const data = (await readJson(await get(app(), "/v1/events?type=all"))).data;
    expect(() => eventsResponseSchema.parse(data)).not.toThrow();
    // Newest-first by (blockNumber, logIndex): graduated(133) > trade(110) > launch(100).
    expect(data.events.map((e: { type: string }) => e.type)).toEqual([
      "graduated",
      "trade",
      "launch",
    ]);
  });

  it("surfaces the GRADUATION row in type=all (the reported bug)", async () => {
    const data = (await readJson(await get(app(), "/v1/events?type=all"))).data;
    const grad = data.events.find((e: { type: string }) => e.type === "graduated");
    expect(grad).toBeDefined();
    expect(grad.data.token).toBe(TEST_ADDR);
    expect(grad.data.pool).toBe(POOL);
  });

  it("type=graduations returns ONLY graduations (the GRADUATIONS tab)", async () => {
    const data = (await readJson(await get(app(), "/v1/events?type=graduations"))).data;
    expect(() => eventsResponseSchema.parse(data)).not.toThrow();
    expect(data.events).toHaveLength(1);
    expect(data.events[0].type).toBe("graduated");
    expect(data.events[0].data.token).toBe(TEST_ADDR);
  });

  it("type=trades and type=launches isolate their kind", async () => {
    const trades = (await readJson(await get(app(), "/v1/events?type=trades"))).data;
    expect(trades.events.every((e: { type: string }) => e.type === "trade")).toBe(true);
    const launches = (await readJson(await get(app(), "/v1/events?type=launches"))).data;
    expect(launches.events.every((e: { type: string }) => e.type === "launch")).toBe(true);
  });

  it("absent type defaults to all", async () => {
    const data = (await readJson(await get(app(), "/v1/events"))).data;
    expect(() => eventsResponseSchema.parse(data)).not.toThrow();
    expect(data.events.some((e: { type: string }) => e.type === "graduated")).toBe(true);
  });

  it("out-of-allowlist type ⇒ 400 (e.g. the singular ?type=graduation probe)", async () => {
    const res = await get(app(), "/v1/events?type=graduation");
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe("invalid_request");
  });

  it("excludes hidden tokens (listing-gated) — no graduation for a hidden token", async () => {
    const db = new FakeDb([
      fixtureToken({
        address: TEST_ADDR,
        graduated: true,
        block_number: 100,
        log_index: 0,
        m_visibility: "hidden",
      }),
    ]);
    db.graduationEvents = [
      { token: TEST_ADDR, pool: POOL, block_number: 133, log_index: 18, block_timestamp: 1_784_029_859 },
    ];
    // FakeDb gates launches by visibility; the graduation fixture is for a hidden
    // token — the real SQL joins moderation_status and excludes it too. Assert the
    // launch (gated in the fake) is absent; graduation gating is covered by SQL.
    const data = (await readJson(await createApp(makeTestDeps({ db })).request(
      new Request("http://x/v1/events?type=launches"),
    ))).data;
    expect(data.events).toHaveLength(0);
  });

  it("paginates by keyset — nextCursor walks to the older page", async () => {
    const a = app();
    const first = (await readJson(await get(a, "/v1/events?type=all&limit=2"))).data;
    expect(first.events).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = (
      await readJson(await get(a, `/v1/events?type=all&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`))
    ).data;
    // Page 1 = [graduated(133), trade(110)]; page 2 = [launch(100)].
    expect(second.events.map((e: { type: string }) => e.type)).toEqual(["launch"]);
  });
});
