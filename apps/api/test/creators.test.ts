/**
 * Creator-fee claimable endpoint (spec §7 / §12.63). GET /v1/creators/:address/
 * claimable: accrued/claimed from the roll-up, live balanceOf as authoritative
 * claimable (with mirror fallback), vault resolution (row → config → 404), and
 * USD computed at request time.
 */
import { describe, expect, it } from "bun:test";
import { creatorClaimableSchema, type CreatorClaimableRow } from "@robbed/shared";
import { createApp } from "../src/app";
import type { CreatorVaultBalanceReader } from "../src/lib/creator-vault";
import { FakeDb, makeTestDeps, readJson, testConfig } from "./helpers";

const CREATOR = "0x1111111111111111111111111111111111111111";
const VAULT = "0x2222222222222222222222222222222222222222";

function claimableRow(overrides: Partial<CreatorClaimableRow> = {}): CreatorClaimableRow {
  return {
    creator: CREATOR,
    vault: VAULT,
    total_accrued_eth: (5n * 10n ** 18n).toString(), // accrued 5 ETH
    total_claimed_eth: (2n * 10n ** 18n).toString(), // claimed 2 ETH
    claimable_eth: (3n * 10n ** 18n).toString(), // mirror = 3 ETH
    last_claim_at: 1_700_000_100,
    updated_at: new Date(1_700_000_100_000).toISOString(),
    ...overrides,
  };
}

function setup(opts: { row?: CreatorClaimableRow | null; live?: string | null; configVault?: string } = {}) {
  const db = new FakeDb();
  if (opts.row !== undefined && opts.row !== null) db.creatorClaimable.set(opts.row.creator, opts.row);
  const reader: CreatorVaultBalanceReader = { async read() {
    return opts.live ?? null;
  } };
  const config = testConfig({ creatorVaultAddress: opts.configVault });
  return makeTestDeps({ db, config, creatorVaultBalance: reader });
}

describe("GET /v1/creators/:address/claimable", () => {
  it("serves accrued/claimed from the roll-up and the LIVE balanceOf as claimable", async () => {
    // live balanceOf = 3.5 ETH (authoritative, differs from the 3 ETH mirror).
    const deps = setup({ row: claimableRow(), live: (3_500_000_000_000_000_000n).toString() });
    const res = await createApp(deps).request(new Request(`http://x/v1/creators/${CREATOR}/claimable`));
    expect(res.status).toBe(200);
    const body = (await readJson(res)).data;
    expect(() => creatorClaimableSchema.parse(body)).not.toThrow();
    expect(body.creator).toBe(CREATOR);
    expect(body.vault).toBe(VAULT);
    expect(body.claimableEth).toBe("3500000000000000000"); // live, not the mirror
    expect(body.totalAccruedEth).toBe((5n * 10n ** 18n).toString());
    expect(body.totalClaimedEth).toBe((2n * 10n ** 18n).toString());
    expect(body.asOf).toBeTruthy();
    // USD computed at request time from the eth/usd snapshot (§2), never constant.
    expect(body.claimable.ethUsd).toBe("2000"); // FakeDb snapshot price
  });

  it("a claim reduces claimable (accrued − claimed mirror when no live read)", async () => {
    // No live balance ⇒ mirror = accrued(5) − claimed(2) = 3 ETH.
    const deps = setup({ row: claimableRow(), live: null });
    const res = await createApp(deps).request(new Request(`http://x/v1/creators/${CREATOR}/claimable`));
    const body = (await readJson(res)).data;
    expect(body.claimableEth).toBe((3n * 10n ** 18n).toString());

    // Claiming the rest → claimed 5, mirror floors to 0.
    const deps2 = setup({
      row: claimableRow({ total_claimed_eth: (5n * 10n ** 18n).toString(), claimable_eth: "0", last_claim_at: 1_700_000_200 }),
      live: null,
    });
    const res2 = await createApp(deps2).request(new Request(`http://x/v1/creators/${CREATOR}/claimable`));
    expect((await readJson(res2)).data.claimableEth).toBe("0");
  });

  it("falls back to the CONFIG vault + zero roll-up when the creator has no row", async () => {
    const deps = setup({ row: null, configVault: VAULT, live: null });
    const res = await createApp(deps).request(new Request(`http://x/v1/creators/${CREATOR}/claimable`));
    expect(res.status).toBe(200);
    const body = (await readJson(res)).data;
    expect(body.vault).toBe(VAULT);
    expect(body.totalAccruedEth).toBe("0");
    expect(body.totalClaimedEth).toBe("0");
    expect(body.claimableEth).toBe("0"); // nothing accrued
  });

  it("404s when no vault exists anywhere (v1/treasury-only, no accrual)", async () => {
    const deps = setup({ row: null }); // no row, no config vault
    const res = await createApp(deps).request(new Request(`http://x/v1/creators/${CREATOR}/claimable`));
    expect(res.status).toBe(404);
  });

  it("400s a malformed creator address", async () => {
    const deps = setup({ configVault: VAULT });
    const res = await createApp(deps).request(new Request("http://x/v1/creators/not-an-address/claimable"));
    expect(res.status).toBe(400);
  });
});
