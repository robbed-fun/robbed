import {
  assertUi,
  connectAs,
  expect,
  portfolio,
  portfolioCopy,
  test,
} from "../harness";

// @flow:PORT-4 — Disconnected: connect-wallet empty state (§12.50a / catalog §3b)
// assertable-layers: UI only   (no subject → no request → nothing indexed/on-chain — waiver)
test(
  "PORT-4 disconnected /portfolio shows the connect prompt, issues no request, and connects in place",
  { tag: ["@flow:PORT-4", "@layer:ui"] },
  async ({ page }) => {
    // Network spy: with no subject the queries stay DISABLED — no /v1/portfolio
    // request may ever leave the page while disconnected.
    const portfolioRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/v1/portfolio/")) portfolioRequests.push(r.url());
    });

    await assertUi("connect prompt renders and NO portfolio request is issued", async () => {
      await page.goto(portfolio.route());
      await expect(page.getByText(portfolioCopy.connectPrompt).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /connect wallet/i }).first()).toBeVisible();
      // No tabs / stat cells exist without a subject.
      await expect(portfolio.holdingsTab(page)).toHaveCount(0);
      // Bounded grace window for a stray disabled-query fire (negative assert).
      await page.waitForTimeout(1_500);
      expect(portfolioRequests).toEqual([]);
    });

    await assertUi("connecting transitions to the connected portfolio IN PLACE (no reload)", async () => {
      // Marker survives only if the document is never reloaded.
      await page.evaluate(() => {
        (window as unknown as Record<string, unknown>).__e2e_no_reload = true;
      });
      await connectAs(page, "trader");
      await expect(portfolio.youSuffix(page).first()).toBeVisible();
      await expect(portfolio.holdingsTab(page)).toBeVisible();
      expect(
        await page.evaluate(
          () => (window as unknown as Record<string, unknown>).__e2e_no_reload,
        ),
      ).toBe(true);
      // The now-resolved subject issues its reads (the PORT-1 surface).
      expect(portfolioRequests.length).toBeGreaterThan(0);
    });
  },
);
