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
import { TEST_ADDR, makeTestDeps, readJson } from "./helpers";

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
