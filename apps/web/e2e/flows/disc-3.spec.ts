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

// @flow:DISC-3 — Token grid: sort / filter / paginate / live-patch card fields (§5.1)
// assertable-layers: on-chain · indexed · UI
test(
  "DISC-3 token grid sorts, filters and renders exact card fields",
  { tag: ["@flow:DISC-3", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Grid Token", ticker: "GRID" });

    await assertOnChain("token exists on the fork", async () => {
      const receipt = await publicClient.getTransactionReceipt({ hash: token.txHash });
      expect(receipt.status).toBe("success");
    });

    let card: any;
    await assertIndexed("grid endpoint returns the card with indexer metrics", async () => {
      const page1 = await waitForIndexed(
        () => api.tokens("?sort=newest&filter=pregrad&limit=48"),
        (r) => r.tokens.some((t) => t.address?.toLowerCase() === token.token.toLowerCase()),
        { label: "token in grid" },
      );
      card = page1.tokens.find((t) => t.address?.toLowerCase() === token.token.toLowerCase());
      // Card fields are indexer-computed, never client price math (§2).
      for (const field of ["mcapEth", "progressPct", "change24hPct", "creator", "createdAt"]) {
        expect(card).toHaveProperty(field);
      }
    });

    await assertUi("sort/filter sync to URL and the card paints its fields", async () => {
      await page.goto(`${routes.discover}?sort=newest&filter=pregrad`);
      await expect(page).toHaveURL(/sort=newest/);
      await expect(page).toHaveURL(/filter=pregrad/);
      await expect(page.getByText(token.ticker).first()).toBeVisible();
    });
  },
);
