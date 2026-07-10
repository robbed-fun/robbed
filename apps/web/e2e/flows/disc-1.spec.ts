import {
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  expect,
  publicClient,
  routes,
  seedToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:DISC-1 — King of the Hill hero: render & navigate (§5.1)
// assertable-layers: on-chain · indexed · UI
test(
  "DISC-1 King of the Hill hero renders and navigates",
  { tag: ["@flow:DISC-1", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Hooded Leader", ticker: "KOTH" });

    await assertOnChain("token deployed on the fork", async () => {
      const receipt = await publicClient.getTransactionReceipt({ hash: token.txHash });
      expect(receipt.status).toBe("success");
    });

    let hero: any;
    await assertIndexed("API ranks a KotH leader (progress × ln(1+vol24h))", async () => {
      hero = await waitForIndexed(
        () => api.kingOfTheHill(),
        (h) => Boolean(h?.address),
        { label: "king-of-the-hill leader" },
      );
      expect(hero.address).toBeTruthy();
    });

    await assertUi("hero paints and the CTA routes to token detail", async () => {
      await page.goto(routes.discover);
      const cta = page.getByRole("link", { name: new RegExp(hero.ticker, "i") }).first();
      await expect(cta).toBeVisible();
      await cta.click();
      await expect(page).toHaveURL(new RegExp(`/t/${hero.address}`, "i"));
    });
  },
);
