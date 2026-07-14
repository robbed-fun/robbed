/**
 * M2-9 read surface smoke: every read endpoint returns the envelope + a
 * schema-valid payload against the FROZEN shared DTOs; unknown token → 404;
 * admin without a session → 401.
 */
import { describe, expect, it } from "bun:test";
import {
  confirmationsResponseSchema,
  ethUsdResponseSchema,
  kingOfTheHillResponseSchema,
  searchResponseSchema,
  statsResponseSchema,
  tokenDetailSchema,
  tokensResponseSchema,
} from "@robbed/shared";
import { createApp } from "../src/app";
import { FakeDb, TEST_ADDR, fixtureToken, makeTestDeps, readJson } from "./helpers";

const app = createApp(makeTestDeps());
const get = (path: string) => app.request(new Request(`http://x${path}`));

describe("meta + health", () => {
  it("healthz is alive", async () => {
    const res = await get("/v1/healthz");
    expect(res.status).toBe(200);
    expect((await readJson(res)).data.ok).toBe(true);
  });
  it("readyz reports all deps ok with fakes", async () => {
    const res = await get("/v1/readyz");
    expect(res.status).toBe(200);
    expect((await readJson(res)).data.checks).toEqual({ db: true, redis: true, r2: true });
  });
  it("readyz 503 is the STANDARD error envelope with upstream_unavailable (api.md normative)", async () => {
    const deps = makeTestDeps();
    deps.db.ping = async () => {
      throw new Error("db down");
    };
    const res = await createApp(deps).request(new Request("http://x/v1/readyz"));
    expect(res.status).toBe(503);
    const body = await readJson(res);
    // No data-carrying 503 special case — one envelope shape for every non-2xx.
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("upstream_unavailable");
    expect(body.error.message).toContain("db"); // failing dep named in message
  });
  it("confirmations + eth-usd are schema-valid", async () => {
    const confirmations = (await readJson(await get("/v1/confirmations"))).data;
    const ethUsd = (await readJson(await get("/v1/eth-usd"))).data;
    expect(() => confirmationsResponseSchema.parse(confirmations)).not.toThrow();
    expect(() => ethUsdResponseSchema.parse(ethUsd)).not.toThrow();
  });
});

describe("token reads", () => {
  it("lists tokens with valid cards", async () => {
    const data = (await readJson(await get("/v1/tokens?sort=trending&filter=all"))).data;
    expect(() => tokensResponseSchema.parse(data)).not.toThrow();
  });
  it("king-of-the-hill is valid", async () => {
    const data = (await readJson(await get("/v1/tokens/king-of-the-hill"))).data;
    expect(() => kingOfTheHillResponseSchema.parse(data)).not.toThrow();
  });
  it("detail is valid for a known token", async () => {
    const data = (await readJson(await get(`/v1/tokens/${TEST_ADDR}`))).data;
    expect(() => tokenDetailSchema.parse(data)).not.toThrow();
  });
  it("detail omits lpTokenId pre-grad and surfaces it for a graduated token", async () => {
    // Pre-grad fixture (lp_token_id null) → field absent.
    const pre = (await readJson(await get(`/v1/tokens/${TEST_ADDR}`))).data;
    expect(pre.lpTokenId).toBeUndefined();
    // Graduated: graduations.lp_token_id surfaces verbatim (COLLECT-1 gap —
    // clients call LPFeeVault.collect(tokenId) from the API, not the raw log).
    const grad = fixtureToken({
      graduated: true,
      graduated_at: 1_700_000_500,
      v3_pool_address: "0x5555555555555555555555555555555555555555",
      lp_token_id: "777",
    });
    const gradApp = createApp(makeTestDeps({ db: new FakeDb([grad]) }));
    const data = (await readJson(await gradApp.request(`/v1/tokens/${TEST_ADDR}`))).data;
    const parsed = tokenDetailSchema.parse(data);
    expect(parsed.lpTokenId).toBe("777");
  });
  it("fees positions the tokensOwed read on the indexed lp_token_id", async () => {
    const grad = fixtureToken({
      graduated: true,
      v3_pool_address: "0x5555555555555555555555555555555555555555",
      lp_token_id: "777",
    });
    const seen: string[] = [];
    const feesApp = createApp(
      makeTestDeps({
        db: new FakeDb([grad]),
        uncollectedFees: {
          async read(input) {
            seen.push(input.lpTokenId);
            return { token: "0", weth: "0" };
          },
        },
      }),
    );
    const res = await feesApp.request(`/v1/tokens/${TEST_ADDR}/fees`);
    expect(res.status).toBe(200);
    expect(seen).toEqual(["777"]);
  });
  it("detail 404s for an unknown token", async () => {
    const res = await get("/v1/tokens/0x9999999999999999999999999999999999999999");
    expect(res.status).toBe(404);
    expect((await readJson(res)).error.code).toBe("not_found");
  });
  it("search returns valid cards", async () => {
    const data = (await readJson(await get("/v1/search?q=test"))).data;
    expect(() => searchResponseSchema.parse(data)).not.toThrow();
  });
  it("stats is valid", async () => {
    const data = (await readJson(await get("/v1/stats"))).data;
    expect(() => statsResponseSchema.parse(data)).not.toThrow();
  });
});

describe("admin auth gate", () => {
  it("rejects the audit log without a session (401)", async () => {
    const res = await get("/v1/admin/audit-log");
    expect(res.status).toBe(401);
    expect((await readJson(res)).error.code).toBe("unauthorized");
  });
});
