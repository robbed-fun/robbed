/**
 * Post-graduation split claimable endpoint (spec §12.69). GET
 * /v1/creators/:address/claimable/:token: accrued/claimed from the per-(creator,
 * token) roll-up, live tokenBalanceOf as authoritative claimable (mirror fallback),
 * WETH-leg USD vs launch-token-leg null USD, vault resolution (row → config → 404).
 */
import { describe, expect, it } from "bun:test";
import {
  creatorTokenClaimableSchema,
  type CreatorTokenClaimableRow,
} from "@robbed/shared";
import { createApp } from "../src/app";
import type { CreatorVaultBalanceReader } from "../src/lib/creator-vault";
import { FakeDb, makeTestDeps, readJson, testConfig } from "./helpers";

const CREATOR = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x3333333333333333333333333333333333333333"; // a graduated launch token
const WETH = "0x4444444444444444444444444444444444444444";
const VAULT = "0x2222222222222222222222222222222222222222";

function tokenRow(overrides: Partial<CreatorTokenClaimableRow> = {}): CreatorTokenClaimableRow {
  return {
    creator: CREATOR,
    token: TOKEN,
    vault: VAULT,
    total_accrued: (5n * 10n ** 18n).toString(), // accrued 5
    total_claimed: (2n * 10n ** 18n).toString(), // claimed 2
    claimable: (3n * 10n ** 18n).toString(), // mirror = 3
    last_claim_at: 1_700_000_100,
    updated_at: new Date(1_700_000_100_000).toISOString(),
    ...overrides,
  };
}

function setup(opts: {
  row?: CreatorTokenClaimableRow | null;
  live?: string | null;
  configVault?: string;
  wethAddress?: string;
} = {}) {
  const db = new FakeDb();
  if (opts.row) db.creatorTokenClaimable.set(`${opts.row.creator}:${opts.row.token}`, opts.row);
  const reader: CreatorVaultBalanceReader = {
    async read() {
      return null;
    },
    async readToken() {
      return opts.live ?? null;
    },
  };
  const config = testConfig({ creatorVaultAddress: opts.configVault, wethAddress: opts.wethAddress });
  return makeTestDeps({ db, config, creatorVaultBalance: reader });
}

describe("GET /v1/creators/:address/claimable/:token", () => {
  it("serves accrued/claimed from the roll-up and the LIVE tokenBalanceOf as claimable", async () => {
    // live tokenBalanceOf = 3.5 (authoritative, differs from the 3 mirror).
    const deps = setup({ row: tokenRow(), live: (3_500_000_000_000_000_000n).toString() });
    const res = await createApp(deps).request(
      new Request(`http://x/v1/creators/${CREATOR}/claimable/${TOKEN}`),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)).data;
    expect(() => creatorTokenClaimableSchema.parse(body)).not.toThrow();
    expect(body.creator).toBe(CREATOR);
    expect(body.token).toBe(TOKEN);
    expect(body.vault).toBe(VAULT);
    expect(body.claimable).toBe("3500000000000000000"); // live, not the mirror
    expect(body.totalAccrued).toBe((5n * 10n ** 18n).toString());
    expect(body.totalClaimed).toBe((2n * 10n ** 18n).toString());
    // Launch-token leg is an unpriceable ERC20 ⇒ USD null (never a constant).
    expect(body.claimableUsd).toBeNull();
    expect(body.asOf).toBeTruthy();
  });

  it("falls back to the accrued − claimed mirror when no live read", async () => {
    const deps = setup({ row: tokenRow(), live: null });
    const res = await createApp(deps).request(
      new Request(`http://x/v1/creators/${CREATOR}/claimable/${TOKEN}`),
    );
    const body = (await readJson(res)).data;
    expect(body.claimable).toBe((3n * 10n ** 18n).toString()); // 5 − 2
  });

  it("populates USD ONLY for the WETH leg (ETH-priced)", async () => {
    const wethRow = tokenRow({ token: WETH });
    const deps = setup({
      row: wethRow,
      live: (1_000_000_000_000_000_000n).toString(), // 1 WETH
      wethAddress: WETH,
    });
    const res = await createApp(deps).request(
      new Request(`http://x/v1/creators/${CREATOR}/claimable/${WETH}`),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)).data;
    expect(() => creatorTokenClaimableSchema.parse(body)).not.toThrow();
    expect(body.token).toBe(WETH);
    expect(body.claimableUsd).not.toBeNull(); // WETH leg carries USD (§2)
    expect(body.claimableUsd.ethUsd).toBeTruthy();
  });

  it("falls back to the CONFIG vault + zero roll-up when the pair has no row", async () => {
    const deps = setup({ row: null, configVault: VAULT, live: null });
    const res = await createApp(deps).request(
      new Request(`http://x/v1/creators/${CREATOR}/claimable/${TOKEN}`),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)).data;
    expect(body.vault).toBe(VAULT);
    expect(body.totalAccrued).toBe("0");
    expect(body.totalClaimed).toBe("0");
    expect(body.claimable).toBe("0"); // nothing accrued
  });

  it("404s when no vault exists anywhere (v1/treasury-only, no accrual)", async () => {
    const deps = setup({ row: null }); // no row, no config vault
    const res = await createApp(deps).request(
      new Request(`http://x/v1/creators/${CREATOR}/claimable/${TOKEN}`),
    );
    expect(res.status).toBe(404);
  });

  it("400s a malformed creator or token address", async () => {
    const deps = setup({ configVault: VAULT });
    const bad1 = await createApp(deps).request(
      new Request(`http://x/v1/creators/not-an-address/claimable/${TOKEN}`),
    );
    expect(bad1.status).toBe(400);
    const bad2 = await createApp(deps).request(
      new Request(`http://x/v1/creators/${CREATOR}/claimable/not-an-address`),
    );
    expect(bad2.status).toBe(400);
  });
});
