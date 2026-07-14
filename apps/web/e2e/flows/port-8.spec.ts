import {
  CORS_HEADERS,
  ROLES,
  assertUi,
  expect,
  portfolio,
  portfolioCopy,
  test,
} from "../harness";

// @flow:PORT-8 — Portfolio read failure → per-region error state + retry (/ catalog)
// assertable-layers: UI only   (an injected failure has no indexed/on-chain leg — waiver)
test(
  "PORT-8 failing portfolio reads degrade per-region with a working Retry — never page-blank",
  { tag: ["@flow:PORT-8", "@layer:ui"] },
  async ({ page }) => {
    const subject = ROLES.trader; // visitor view via ?address= — no wallet needed
    const addr = subject.address.toLowerCase();

    const failWith = async (route: import("@playwright/test").Route) =>
      route.fulfill({
        status: 500,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({
          data: null,
          error: { code: "internal", message: "e2e injected failure" },
        }),
      });

    // Matchers are kept as named references so unroute() lifts exactly them.
    const summaryOnly = (url: URL) => url.pathname === `/v1/portfolio/${addr}`;
    const holdingsOnly = (url: URL) => url.pathname === `/v1/portfolio/${addr}/holdings`;

    await assertUi("summary fails alone: its ErrorState renders while the tabs stay intact", async () => {
      await page.route(summaryOnly, failWith);
      await page.goto(portfolio.route(subject.address));
      await expect(page.getByText(portfolioCopy.summaryError)).toBeVisible();
      // No fabricated substitutes: the stat cells are absent while failing.
      await expect(page.getByText(/total value/i)).toHaveCount(0);
      // Independence: HOLDINGS still loads (rows or its EMPTY state — never its error).
      await expect(portfolio.holdingsTab(page)).toBeVisible();
      await expect(page.getByText(portfolioCopy.holdingsError)).toHaveCount(0);
    });

    await assertUi("summary Retry refetches and renders the real roll-up", async () => {
      await page.unroute(summaryOnly);
      await portfolio.retry(page).click();
      await expect(page.getByText(/\d+ trades?/).first()).toBeVisible();
      await expect(page.getByText(/total value/i).first()).toBeVisible();
      await expect(page.getByText(portfolioCopy.summaryError)).toHaveCount(0);
    });

    await assertUi("holdings fails alone: region error + Retry, summary untouched", async () => {
      await page.route(holdingsOnly, failWith);
      await page.goto(portfolio.route(subject.address));
      await expect(page.getByText(portfolioCopy.holdingsError)).toBeVisible();
      // Independence the other way: the summary header renders fine.
      await expect(page.getByText(/total value/i).first()).toBeVisible();
      await expect(page.getByText(portfolioCopy.summaryError)).toHaveCount(0);
      // Retry after the failure clears → real holdings content replaces the error.
      await page.unroute(holdingsOnly);
      await portfolio.retry(page).click();
      await expect(page.getByText(portfolioCopy.holdingsError)).toHaveCount(0);
      // Rows or the honest empty state — either is a successful read.
      await expect(
        page.locator('a[href^="/t/"]').first().or(page.getByText(portfolioCopy.noHoldings)),
      ).toBeVisible();
    });
  },
);
