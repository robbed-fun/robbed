import {
  api,
  assertIndexed,
  assertUi,
  expect,
  routes,
  seedToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:TD-11 — Token info, Blockscout links, creator profile (§5.2)
// assertable-layers: indexed · UI   (N/A on-chain: display of indexer metadata — waiver)
test(
  "TD-11 token info renders description, https-only links and Blockscout links",
  { tag: ["@flow:TD-11", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({
      name: "Info Coin",
      ticker: "INFO",
      description: "A token used by the TD-11 e2e flow.",
    });

    await assertIndexed("token summary + metadata are indexer-sourced", async () => {
      const t = await waitForIndexed(
        () => api.token(token.token),
        (t) => Boolean(t?.address && t?.creator),
        { label: "token info indexed" },
      );
      expect(t.creator).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    await assertUi("info block shows description + Blockscout contract link", async () => {
      await page.goto(routes.token(token.token));
      await expect(page.getByText(/TD-11 e2e flow/i).first()).toBeVisible();
      const explorerLink = page.getByRole("link", { name: /blockscout|contract|explorer/i }).first();
      await expect(explorerLink).toHaveAttribute("href", /robinhoodchain\.blockscout\.com/);
    });
  },
);
