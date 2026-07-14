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

// @flow:DISC-2 — Live launch ticker (WebSocket)
// assertable-layers: on-chain · indexed · UI
test(
  "DISC-2 live launch ticker slides in a new launch",
  { tag: ["@flow:DISC-2", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    await page.goto(routes.discover);

    // Create a token AFTER the page is live so the WS `launch` message drives it in.
    const token = await seedToken({ name: "Ticker Coin", ticker: "TICK" });

    await assertOnChain("createToken succeeded on the fork", async () => {
      const receipt = await publicClient.getTransactionReceipt({ hash: token.txHash });
      expect(receipt.status).toBe("success");
    });

    await assertIndexed("indexer materializes the launch record", async () => {
      await waitForIndexed(
        () => api.token(token.token),
        (t) => Boolean(t?.address),
        { label: "launch indexed" },
      );
    });

    await assertUi("ticker entry appears at the head and links to detail", async () => {
      // Tape rows are <Link href="/t/<addr>"> whose visible text is the token
      // NAME (the ticker only feeds the avatar) — target the href, then check
      // the row renders this launch's name.
      const entry = page.locator(`a[href="/t/${token.token.toLowerCase()}"]`).first();
      await expect(entry).toBeVisible({ timeout: 15_000 });
      await expect(entry).toContainText(new RegExp(token.name, "i"));
      await entry.click();
      await expect(page).toHaveURL(new RegExp(`/t/${token.token}`, "i"));
    });
  },
);
