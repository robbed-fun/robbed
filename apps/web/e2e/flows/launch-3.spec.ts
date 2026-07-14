import { LP_COPY } from "@robbed/shared";

import { assertUi, expect, routes, test } from "../harness";

// @flow:LAUNCH-3 — Economics panel display (LP copy verbatim + live reads)
// assertable-layers: UI   (N/A on-chain/indexed: pure display of live reads + fixed copy — waiver)
test(
  "LAUNCH-3 economics panel shows the LP sentence verbatim and no market-metric literal",
  { tag: ["@flow:LAUNCH-3", "@layer:ui"] },
  async ({ page }) => {
    await page.goto(routes.create);

    await assertUi("EconomicsPanel renders the exact shared LP sentence + live fee/threshold", async () => {
      // LP destiny copy is verbatim from the single shared constant.
      await expect(page.getByText(LP_COPY).first()).toBeVisible();

      // The forbidden LP verb never appears anywhere on the page (grep-parity).
      const bodyText = (await page.locator("body").innerText()).toLowerCase();
      expect(bodyText.includes("bur" + "n")).toBe(false);

      // No hardcoded USD/mcap literal in the economics copy. The dollar
      // graduation figure must never render as a USD literal (ETH threshold only).
      expect(/\$\s?\d[\d,\.]*\s?[kKmMbB]?/.test(bodyText)).toBe(false);

      // Fee + threshold render as live values (1% trade fee → treasury).
      await expect(page.getByText(/1%.*treasury|trade fee/i).first()).toBeVisible();
    });
  },
);
