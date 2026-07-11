import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  api,
  assertIndexed,
  assertUi,
  expect,
  portfolio,
  portfolioCopy,
  test,
} from "../harness";

// @flow:PORT-7 — Empty portfolio (never-traded address; never a 404) (§12.50a / catalog §3b)
// assertable-layers: indexed · UI   (the empty payload IS the indexer response — waiver)
test(
  "PORT-7 a never-traded address resolves to an honestly-empty portfolio, never a 404",
  { tag: ["@flow:PORT-7", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    // A freshly generated address — guaranteed no trades/holdings/created tokens.
    const fresh = privateKeyToAccount(generatePrivateKey()).address;

    await assertIndexed("all four portfolio reads resolve EMPTY (no 404, no error envelope)", async () => {
      // api.get throws on any error envelope — resolving at all proves §3.4a.
      const summary = await api.portfolioSummary(fresh);
      expect(summary.tradeCount).toBe(0);
      expect(summary.tokensCreated).toBe(0);
      expect(summary.firstSeenAt).toBeNull();
      const holdings = await api.portfolioHoldings(fresh);
      expect(holdings.holdings).toEqual([]);
      expect(holdings.nextCursor).toBeNull();
      const activity = await api.portfolioActivity(fresh);
      expect(activity.activity).toEqual([]);
      const created = await api.portfolioCreated(fresh);
      expect(created.tokens).toEqual([]);
    });

    await assertUi("each region renders its EMPTY state — emptiness never gets error treatment", async () => {
      await page.goto(portfolio.route(fresh));
      // Summary renders honest zeros, not an error.
      await expect(page.getByText(/0 trades/).first()).toBeVisible();
      await expect(page.getByText(portfolioCopy.summaryError)).toHaveCount(0);
      // HOLDINGS (default): empty state + Discover CTA to `/`.
      await expect(page.getByText(portfolioCopy.noHoldings)).toBeVisible();
      await expect(page.getByRole("link", { name: /discover tokens/i })).toHaveAttribute("href", "/");
      // ACTIVITY: "No trades yet".
      await portfolio.activityTab(page).click();
      await expect(page.getByText(portfolioCopy.noTrades)).toBeVisible();
      // CREATED: "No tokens created" + CTA to /create.
      await portfolio.createdTab(page).click();
      await expect(page.getByText(portfolioCopy.noCreated)).toBeVisible();
      await expect(page.getByRole("link", { name: /launch a token/i })).toHaveAttribute(
        "href",
        "/create",
      );
      // No region ever shows error treatment for emptiness.
      await expect(page.getByText(/couldn't load/i)).toHaveCount(0);
    });
  },
);
