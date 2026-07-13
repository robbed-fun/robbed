import { TOTAL_SUPPLY_WEI } from "@robbed/shared";
import { launchTokenAbi } from "@robbed/shared/abi";

import {
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  connectAs,
  expect,
  launch,
  publicClient,
  routes,
  seedToken,
  test,
  waitForIndexed,
} from "../harness";

// A minimal PNG for the required image field (API re-encodes server-side).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

// @flow:LAUNCH-1 — Create token, no initial buy · tx `createToken` (§5.3)
// assertable-layers: on-chain · indexed · UI
test(
  "LAUNCH-1 create token (no initial buy) → Tradeable confirmation → redirect → tradeable",
  { tag: ["@flow:LAUNCH-1", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    void seedToken; // (kept in the barrel import surface; UI drives creation here)
    await page.goto(routes.create);
    await connectAs(page, "creator");

    let tokenAddress = "";
    await assertUi("form submits, stepper reaches the Tradeable confirmation and redirects to /t/[address]", async () => {
      await launch.name(page).fill("Launched Coin");
      await launch.ticker(page).fill("LNCH");
      await launch.description(page).fill("LAUNCH-1 e2e create, no initial buy.");
      await launch.fileInput(page).setInputFiles({
        name: "logo.png",
        mimeType: "image/png",
        buffer: PNG,
      });
      // Eager upload + metadata pin complete before submit becomes enabled.
      await launch.submit(page).click();
      // §12.56 dropped the visible "Soft-confirmed" launch label; the receipt-
      // success confirmation node now reads "Tradeable" (`launchStepLabel` +
      // LaunchProgress). Assert the launch stepper card surfaces it (the shared
      // ConfirmationBadge stays absent for the soft-confirmed tier, §12.56), then
      // the flow reaches `live` and redirects to the token.
      await expect(page.getByRole("heading", { name: "Launching" })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText("Tradeable").first()).toBeVisible({ timeout: 20_000 });
      await page.waitForURL(/\/t\/0x[0-9a-fA-F]{40}/, { timeout: 30_000 });
      tokenAddress = new URL(page.url()).pathname.split("/t/")[1] ?? "";
      expect(tokenAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    let detail: any;
    await assertIndexed("the new token is indexed and listed", async () => {
      detail = await waitForIndexed(
        () => api.token(tokenAddress),
        (t) => Boolean(t?.address),
        { label: "launched token indexed" },
      );
      expect(detail.ticker).toBe("LNCH");
    });

    await assertOnChain("the ownerless token has the fixed 1B supply on chain", async () => {
      const supply = (await publicClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: launchTokenAbi,
        functionName: "totalSupply",
      })) as bigint;
      expect(supply).toBe(TOTAL_SUPPLY_WEI);
    });
  },
);
