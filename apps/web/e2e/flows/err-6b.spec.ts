import { launchTokenAbi } from "@robbed/shared/abi";

import {
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  copy,
  expect,
  publicClient,
  routes,
  test,
  waitForIndexed,
} from "../harness";

// @flow:ERR-6b — Metadata mismatch verdict on Trust panel (§8.3)
// assertable-layers: on-chain · indexed · UI  (full 3-layer)
//
// Requires an INDEXER-PROVIDED fixture: a token whose ON-CHAIN committed
// metadataHash ≠ the keccak of its (post-launch mutated) stored canonical JSON,
// so the indexer emits the ⚠ MISMATCH verdict. `dev:seed` supplies it via
// `E2E_MISMATCH_TOKEN` (gap noted to robbed-indexer if absent).
test(
  "ERR-6b Trust panel renders the indexer's ⚠ MISMATCH verdict for a changed metadata",
  { tag: ["@flow:ERR-6b", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const address = process.env.E2E_MISMATCH_TOKEN;
    test.skip(
      !address,
      "ERR-6b needs an indexer mismatch fixture (E2E_MISMATCH_TOKEN from dev:seed).",
    );
    const token = address!;

    await assertOnChain("the on-chain committed metadataHash is present and immutable", async () => {
      const committed = (await publicClient.readContract({
        address: token as `0x${string}`,
        abi: launchTokenAbi,
        functionName: "metadataHash",
      })) as `0x${string}`;
      expect(committed).toMatch(/^0x[0-9a-fA-F]{64}$/);
    });

    await assertIndexed("the indexer's verdict is MISMATCH", async () => {
      const t = await waitForIndexed(
        () => api.token(token),
        (t: any) => (t?.trust?.metadataVerdict ?? t?.metadataVerdict) === "mismatch",
        { label: "mismatch verdict" },
      );
      expect(t).toBeTruthy();
    });

    await assertUi("row 7 renders the red MISMATCH state (frontend never overrides)", async () => {
      await page.goto(routes.token(token));
      await expect(page.getByText(copy.metadataMismatch).first()).toBeVisible();
    });
  },
);
