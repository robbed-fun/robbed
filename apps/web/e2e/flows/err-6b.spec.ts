import { launchTokenAbi } from "@robbed/shared/abi";

import {
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  canProvisionMismatchFixture,
  copy,
  expect,
  publicClient,
  routes,
  seedMismatchToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:ERR-6b — Metadata mismatch verdict on the SafetyStrip (§8.3)
// assertable-layers: on-chain · indexed · UI  (full 3-layer)
//
// §12.57 (2026-07-12): the deleted Trust panel's ⚠ MISMATCH verdict RELOCATES to the
// compact SafetyStrip — its metadata tick renders "Metadata MISMATCH" (red). The
// indexer verdict, the never-override rule, and the layers are unchanged; only the
// display surface's name moved (cosmetic).
//
// Fixture: a token whose ON-CHAIN committed metadataHash ≠ the keccak of its
// stored canonical JSON. SELF-PROVISIONED by the harness (seedMismatchToken:
// pin → tamper the stored object via minio `mc` → createToken committing the
// original hash), so no dev:seed dependency remains. `E2E_MISMATCH_TOKEN`
// still wins when supplied (remote stacks without docker access).
test(
  "ERR-6b SafetyStrip renders the indexer's ⚠ MISMATCH verdict for a changed metadata",
  { tag: ["@flow:ERR-6b", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    // The verifier pass runs every 30s — allow one full cadence plus fetch.
    test.setTimeout(180_000);
    let token = process.env.E2E_MISMATCH_TOKEN;
    if (!token) {
      test.skip(
        !canProvisionMismatchFixture(),
        "ERR-6b needs the compose minio container (or E2E_MISMATCH_TOKEN) to build the tamper fixture.",
      );
      token = (await seedMismatchToken()).token;
    }

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
        () => api.token(token!),
        (t: any) => t?.trust?.metadataVerification?.status === "mismatch",
        { label: "mismatch verdict", timeoutMs: 90_000, intervalMs: 2_000 },
      );
      expect(t.trust.metadataVerification.computedHash).not.toBe(
        t.trust.metadataVerification.onchainHash,
      );
    });

    await assertUi("the SafetyStrip renders the red MISMATCH tick (frontend never overrides)", async () => {
      await page.goto(routes.token(token!));
      await expect(page.getByText(copy.metadataMismatch).first()).toBeVisible();
    });
  },
);
