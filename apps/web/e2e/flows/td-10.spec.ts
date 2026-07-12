import {
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  buyOnChain,
  expect,
  holderFlags,
  publicClient,
  routes,
  ROLES,
  seedToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:TD-10 — Top Holders table: rank · address · label · amount · % (§12.58/§12.59)
// AMENDED 2026-07-12: the holder list is promoted into the right-column Top
// Holders table (common DataTable) that REPLACES the deleted Trust panel, with
// SERVER-SIDE sort + keyset pagination. Layers unchanged.
// assertable-layers: on-chain · indexed · UI
test(
  "TD-10 Top Holders table renders rank/label/amount rows with creator/curve/vault labels",
  { tag: ["@flow:TD-10", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Holder Coin", ticker: "HOLD" });
    const buyHash = await buyOnChain({ buyer: ROLES.trader, token: token.token, ethWei: 6n * 10n ** 16n });

    await assertOnChain("a holder-creating buy lands on the fork", async () => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: buyHash });
      expect(receipt.status).toBe("success");
    });

    await assertIndexed("holders endpoint returns ranked rows with flags", async () => {
      const res = await waitForIndexed(
        () => api.holders(token.token, 20),
        (r) => (r.holders?.length ?? 0) > 0,
        { label: "holders indexed" },
      );
      // The bonding curve must be flagged among the rows.
      expect(res.holders.some((h: any) => holderFlags(h).includes("curve"))).toBe(true);
    });

    await assertUi("Top Holders table renders titled rows with a role label", async () => {
      await page.goto(routes.token(token.token));
      await expect(page.getByText(/top holders/i).first()).toBeVisible();
      // The RULED label column shows the account role (Bonding curve/Creator/Vault).
      await expect(page.getByText(/bonding curve|creator|vault/i).first()).toBeVisible();
    });
  },
);
