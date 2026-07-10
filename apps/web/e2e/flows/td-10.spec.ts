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

// @flow:TD-10 — Holder distribution (top 20) (§5.2)
// assertable-layers: on-chain · indexed · UI
test(
  "TD-10 holder table lists top holders with creator/curve/vault flags",
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

    await assertUi("holder table renders ranks and a flagged row", async () => {
      await page.goto(routes.token(token.token));
      await expect(page.getByText(/holders/i).first()).toBeVisible();
      await expect(page.getByText(/curve|creator|vault/i).first()).toBeVisible();
    });
  },
);
