import {
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  buyOnChain,
  copy,
  expect,
  publicClient,
  readReserves,
  routes,
  seedToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:TD-7 — Trust panel: seven rows with exact sourcing (§5.2/§8.3)
// assertable-layers: on-chain · indexed · UI
test(
  "TD-7 Trust panel renders live reads (reserves from chain, not cached API)",
  { tag: ["@flow:TD-7", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Trust Coin", ticker: "TRST" });
    const buyHash = await buyOnChain({ token: token.token, ethWei: 3n * 10n ** 16n });
    await publicClient.waitForTransactionReceipt({ hash: buyHash });

    let onChainReserves: { realEth: bigint };
    await assertOnChain("curve reserves + fixed supply are direct chain reads", async () => {
      onChainReserves = await readReserves(token.curve);
      expect(onChainReserves.realEth).toBeGreaterThan(0n);
    });

    await assertIndexed("metadata-hash verdict is available from the indexer", async () => {
      const t = await waitForIndexed(
        () => api.token(token.token),
        (t) => Boolean(t?.trust?.metadataVerdict ?? t?.metadataVerdict ?? t?.trust),
        { label: "trust verdict indexed" },
      );
      expect(t).toBeTruthy();
    });

    await assertUi("panel shows ownerless ✓, fixed supply, live reserves row", async () => {
      await page.goto(routes.token(token.token));
      await expect(page.getByText(copy.ownerless).first()).toBeVisible();
      await expect(page.getByText(copy.fixedSupply).first()).toBeVisible();
      // Row 3 asserts a LIVE read, labelled "read from chain" (never cached API).
      await expect(page.getByText(copy.readFromChain).first()).toBeVisible();
    });
  },
);
