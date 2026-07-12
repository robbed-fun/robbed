import {
  ROLES,
  api,
  assertIndexed,
  assertUi,
  buyOnChain,
  connectAs,
  expect,
  parseEther,
  portfolio,
  publicClient,
  seedToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:PORT-6 — Address-subject variant: viewing an arbitrary wallet (?address=) (§12.50a / catalog §3b)
// assertable-layers: indexed · UI   (same read-only reads, different subject — waiver)
test(
  "PORT-6 ?address= takes precedence, omits '· you', stays read-only, and swaps subjects cleanly",
  { tag: ["@flow:PORT-6", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    // Foreign subject = trader2, whose holding we seed with a real curve buy.
    const foreign = ROLES.trader2;
    const connected = ROLES.trader;
    const token = await seedToken({ name: "Port Other", ticker: "PRT6" });
    const buyTx = await buyOnChain({ buyer: foreign, token: token.token, ethWei: parseEther("0.01") });
    await publicClient.waitForTransactionReceipt({ hash: buyTx });

    await assertIndexed("the foreign subject's holdings resolve over the same read path", async () => {
      const res = await waitForIndexed(
        () => api.portfolioHoldings(foreign.address),
        (d) => d.holdings.some((h) => h.token.address.toLowerCase() === token.token.toLowerCase()),
        { label: "foreign subject holding indexed" },
      );
      const holding = res.holdings.find(
        (h) => h.token.address.toLowerCase() === token.token.toLowerCase(),
      );
      expect(BigInt(holding.balance) > 0n).toBe(true);
    });

    await assertUi("explicit ?address= wins over the connected wallet; no '· you', no trade affordance", async () => {
      await page.goto(portfolio.route(foreign.address));
      await connectAs(page, "trader"); // connected wallet ≠ subject
      // The explicit subject renders — not the connected wallet.
      await expect(portfolio.addressChip(page, foreign.address)).toBeVisible();
      await expect(portfolio.youSuffix(page)).toHaveCount(0);
      // The seeded holding renders for the foreign subject.
      await expect(
        page.locator(`a[href="/t/${token.token.toLowerCase()}"]`).filter({ hasText: token.name }).first(),
      ).toBeVisible();
      // Read-only surface: no trade tabs / submit affordance exists here.
      await expect(page.getByRole("tab", { name: /^buy$/i })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^(buy|sell)\s/i })).toHaveCount(0);
    });

    await assertUi("dropping ?address= falls back to the connected wallet ('· you' returns)", async () => {
      // Drop the filter via CLIENT-SIDE navigation (header nav) — a full reload
      // would sever the mock-connector session (all four share the `mock`
      // connector id, so wagmi's reconnect-on-mount cannot restore it; harness
      // limitation, not a product surface).
      await page.getByRole("link", { name: /^portfolio$/i }).first().click();
      await expect(page).toHaveURL(/\/portfolio(?!\?)/);
      await expect(portfolio.addressChip(page, connected.address)).toBeVisible();
      await expect(portfolio.youSuffix(page).first()).toBeVisible();
    });
  },
);
