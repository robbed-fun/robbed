---
name: charts
description: >-
  ROBBED_ price-chart implementation and debugging skill for the Next.js web app.
  Use when working on lightweight-charts, candlestick rendering, time axes,
  candle intervals, sparse/idle-token chart windows, chart screenshots, token
  detail chart bugs, or tests around PriceChart/useCandleFeed/candles.
---

# ROBBED_ Charts

Use this skill for `apps/web/src/widgets/price-chart/**` and token-detail chart
behavior. The chart renders one venue-continuous candlestick series across curve
and V3 trading; do not add a second price series for graduation.

## Source Map

- UI: `apps/web/src/widgets/price-chart/ui/PriceChart.tsx`
- Data transforms/windows: `apps/web/src/widgets/price-chart/model/candles.ts`
- Feed hook: `apps/web/src/widgets/price-chart/model/use-candle-feed.ts`
- Token-detail SSR anchor: `apps/web/src/views/token-detail/ui/TokenDetailView.tsx`
- Client anchor wiring: `apps/web/src/views/token-detail/ui/TokenDetailClient.tsx`
- Shared intervals: `packages/shared/src/constants.ts`
- Tests: `apps/web/tests/price-chart-locale.test.tsx`,
  `apps/web/tests/candle-window.test.ts`, `apps/web/tests/use-candle-feed.test.tsx`
- Spec references: `docs/developers/web.md` chart section,
  `docs/developers/design-decisions.md` D-71, D-72, D-76

## Rules

- Use `lightweight-charts` v5 APIs: `createChart`, `chart.addSeries(...)`,
  `series.setData(...)`, `series.update(...)`, `createSeriesMarkers(...)`.
  Check installed typings under `node_modules/.../lightweight-charts/dist/typings.d.ts`
  before using unfamiliar options.
- Keep one `CandlestickSeries` for price and one hidden-label `HistogramSeries`
  for volume. Graduation is an annotation marker only.
- Preserve raw candle `close`. If flat one-trade candles need visibility, use a
  display-only transform for `open/high/low`; never rewrite API/indexer data.
- Time-axis fixes must be interval-aware for all six intervals:
  `1s`, `15s`, `1m`, `5m`, `15m`, `1h`.
- Sparse charts must use real interval whitespace and `setVisibleRange(...)`,
  not arbitrary logical slots that hide the real time spacing.
- Empty chart copy appears only when the token has never traded
  (`token.priceEth === null`), not when a short interval missed old activity.
- Layout constants are canvas geometry only. Do not introduce price, TVL,
  mcap, or volume thresholds into chart presentation logic.

## Workflow

1. Reproduce against the running stack if possible:
   ```bash
   curl -I http://localhost:4200/t/<token>
   ```
2. Inspect live candle payloads before changing UI assumptions:
   ```bash
   curl "http://localhost:4201/v1/tokens/<token>/candles?interval=1m&from=<from>&to=<to>"
   ```
3. Patch the smallest layer that owns the problem:
   - bad fetch window or idle token: `model/candles.ts`
   - wrong seed/anchor: token-detail view/client wiring
   - axis, formatting, rendering, canvas layout: `PriceChart.tsx`
4. Verify every interval visually with Playwright screenshots. Capture at least:
   `1S`, `15S`, `1M`, `5M`, `15M`, `1H`.
5. Run focused checks:
   ```bash
   pnpm --filter @robbed/web test -- tests/price-chart-locale.test.tsx tests/candle-window.test.ts tests/use-candle-feed.test.tsx
   pnpm --filter @robbed/web typecheck
   git diff --check
   ```

## Screenshot Harness

Use this pattern from repo root to inspect the chart canvas:

```bash
pnpm --filter @robbed/web exec node <<'NODE'
const { chromium } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");

(async () => {
  const token = process.env.TOKEN ?? "0x188d0bb913e28292cd985f97fecdd31daf198a0d";
  const out = path.join(process.cwd(), "..", "..", "tmp", "chart-timescales");
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1240, height: 900 } });
  await page.goto(`http://localhost:4200/t/${token}`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  for (const label of ["1S", "15S", "1M", "5M", "15M", "1H"]) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    await page.waitForTimeout(1800);
    const chart = page
      .locator("text=price / ETH")
      .locator('xpath=ancestor::div[contains(@class,"flex")][1]/following-sibling::div')
      .first();
    await chart.screenshot({ path: path.join(out, `${label.toLowerCase()}.png`) });
  }
  await browser.close();
})();
NODE
```

Review screenshots with `view_image`. Do not rely only on DOM tests; most chart
failures are canvas rendering or axis-range bugs.
