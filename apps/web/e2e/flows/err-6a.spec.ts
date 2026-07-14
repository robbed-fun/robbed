import { CORS_HEADERS, assertUi, connectAs, expect, launch, routes, test } from "../harness";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

// @flow:ERR-6a — Metadata hash mismatch: client re-verify blocks signing
// assertable-layers: UI   (N/A on-chain/indexed: signing blocked → no tx — waiver)
test(
  "ERR-6a a tampered API metadataHash blocks signing before any tx is broadcast",
  { tag: ["@flow:ERR-6a", "@layer:ui"] },
  async ({ page }) => {
    // Tamper the API's metadata response so its hash disagrees with the client's
    // own canonicalize+keccak (the normative pre-sign re-verification).
    await page.route("**/v1/metadata", async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      if (json?.data?.metadataHash) {
        json.data.metadataHash = "0x" + "de".repeat(32); // corrupt hash
      }
      await route.fulfill({
        response: res,
        json,
        headers: { ...res.headers(), ...CORS_HEADERS },
      });
    });

    await page.goto(routes.create);
    await connectAs(page, "creator");

    await assertUi("client detects the mismatch and blocks signing; no navigation", async () => {
      await launch.name(page).fill("Mismatch Coin");
      await launch.ticker(page).fill("MISM");
      await launch.fileInput(page).setInputFiles({
        name: "logo.png",
        mimeType: "image/png",
        buffer: PNG,
      });
      await launch.submit(page).click();
      await expect(page.getByText(/mismatch|verify|hash|does not match/i).first()).toBeVisible({
        timeout: 15_000,
      });
      // Signing was blocked → still on /create, never redirected to /t/[address].
      await expect(page).toHaveURL(/\/create/);
    });
  },
);
