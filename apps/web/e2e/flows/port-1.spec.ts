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
  portfolioCopy,
  publicClient,
  readMaxEarlyBuy,
  seedToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:PORT-1 — Connected-wallet portfolio: summary header + holdings (/ catalog)
// assertable-layers: indexed · UI   (base Portfolio read flow, no transaction — waiver)
test(
  "PORT-1 connected portfolio renders summary header + HOLDINGS from the indexed roll-up",
  { tag: ["@flow:PORT-1", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const subject = ROLES.creator;
    // This Portfolio read flow has no transaction: seed the subject's state the product's own way —
    // a real curve buy from the subject wallet on a freshly created token.
    const token = await seedToken({ name: "Port Hold", ticker: "PRT1" });
    const maxEarlyBuy = await readMaxEarlyBuy(token.curve);
    const targetBuy = parseEther("0.002");
    const ethWei = maxEarlyBuy < targetBuy ? (maxEarlyBuy * 80n) / 100n : targetBuy;
    const buyTx = await buyOnChain({
      buyer: subject,
      token: token.token,
      ethWei,
    });
    expect((await publicClient.waitForTransactionReceipt({ hash: buyTx })).status).toBe("success");

    let summary: any;
    await assertIndexed("summary roll-up + holdings materialize for the subject", async () => {
      await waitForIndexed(
        () => api.portfolioHoldings(subject.address),
        (d) => d.holdings.some((h) => h.token.address.toLowerCase() === token.token.toLowerCase()),
        { label: "seeded holding indexed", timeoutMs: 60_000 },
      );
      summary = await waitForIndexed(
        () => api.portfolioSummary(subject.address),
        (s) => (s?.tradeCount ?? 0) >= 1,
        { label: "summary tradeCount >= 1", timeoutMs: 60_000 },
      );
      // The roll-up is API-owned: ETH-first fields exist; PnL is the honest
      // nullable RANGE shape — never a bare fabricated point number.
      expect(BigInt(summary.walletEthBalance) > 0n).toBe(true);
      expect(BigInt(summary.totalValueEth) > 0n).toBe(true);
      expect(
        summary.pnlAllTime === null ||
          ("low" in summary.pnlAllTime && "high" in summary.pnlAllTime),
      ).toBe(true);
    });

    await assertUi("header identity, stat cells, and default HOLDINGS rows render", async () => {
      await page.goto(portfolio.route());
      await connectAs(page, "creator");
      // Subject resolves in place to the connected wallet: chip + "· you".
      await expect(portfolio.addressChip(page, subject.address)).toBeVisible();
      await expect(portfolio.youSuffix(page).first()).toBeVisible();
      await expect(page.getByText(/\d+ trades?/).first()).toBeVisible();
      // Stat cells TOTAL VALUE / LOOT ALL-TIME / WALLET ETH from the roll-up.
      for (const label of portfolioCopy.statLabels) {
        await expect(page.getByText(label).first()).toBeVisible();
      }
      // Default tab is HOLDINGS and it carries the seeded token's row (TOKEN
      // cell renders the name; the row links to /t/<address>).
      await expect(portfolio.holdingsTab(page)).toHaveAttribute("aria-selected", "true");
      const row = page
        .locator(`a[href="/t/${token.token.toLowerCase()}"]`)
        .filter({ hasText: token.name })
        .first();
      await expect(row).toBeVisible();
      // ETH-first: the row's VALUE renders an ETH figure (USD only as a mirror).
      await expect(row.getByText(/ETH/).first()).toBeVisible();
    });
  },
);
