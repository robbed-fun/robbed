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

// @flow:DISC-3 — Event tape: seeded snapshot, tab filter, registry-sourced
// metrics, navigate (§5.1 as amended by §12.50(f) — replaces the retired token
// grid's sort/filter/paginate surface)
// assertable-layers: on-chain · indexed · UI
test(
  "DISC-3 event tape seeds real LAUNCH rows, filters by tab and navigates",
  { tag: ["@flow:DISC-3", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Tape Runner", ticker: "TAPE" });

    await assertOnChain("token exists on the fork", async () => {
      const receipt = await publicClient.getTransactionReceipt({ hash: token.txHash });
      expect(receipt.status).toBe("success");
    });

    await assertIndexed("newest list (the tape's seed + enrichment registry) has the token", async () => {
      const list = await waitForIndexed(
        () => api.tokens("?sort=newest&filter=all&limit=40"),
        (r) => r.tokens.some((t) => t.address?.toLowerCase() === token.token.toLowerCase()),
        { label: "token in tape seed" },
      );
      const card = list.tokens.find(
        (t) => t.address?.toLowerCase() === token.token.toLowerCase(),
      );
      // Tape rows resolve mcap/Δ% from these indexer aggregates by reference —
      // never client price math, never fabricated (§2).
      for (const field of ["mcapEth", "change24hPct", "creator", "createdAt"]) {
        expect(card).toHaveProperty(field);
      }
    });

    await assertUi("LAUNCH row paints, tabs filter it, row click navigates", async () => {
      // Discover SSR revalidates ~5s — reload until the seeded LAUNCH row paints.
      await page.goto(routes.discover);
      const row = page.getByRole("link", { name: /Tape Runner/i }).first();
      await expect(async () => {
        await page.reload();
        await expect(row).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 20_000 });

      // Tab filter: TRADES hides the launch row; LAUNCHES brings it back.
      await page.getByRole("tab", { name: /^trades$/i }).click();
      await expect(row).toBeHidden();
      await page.getByRole("tab", { name: /^launches$/i }).click();
      await expect(row).toBeVisible();

      // Row click → token detail.
      await row.click();
      await expect(page).toHaveURL(new RegExp(`/t/${token.token}`, "i"));
    });
  },
);
