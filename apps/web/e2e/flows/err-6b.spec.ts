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

// @flow:ERR-6b — Metadata mismatch verdict on Trust panel (§8.3)
// assertable-layers: on-chain · indexed · UI  (full 3-layer)
//
// Fixture: a token whose ON-CHAIN committed metadataHash ≠ the keccak of its
// stored canonical JSON. SELF-PROVISIONED by the harness (seedMismatchToken:
// pin → tamper the stored object via minio `mc` → createToken committing the
// original hash), so no dev:seed dependency remains. `E2E_MISMATCH_TOKEN`
// still wins when supplied (remote stacks without docker access).
test(
  "ERR-6b Trust panel renders the indexer's ⚠ MISMATCH verdict for a changed metadata",
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

    await assertUi("row 7 renders the red MISMATCH state (frontend never overrides)", async () => {
      await page.goto(routes.token(token!));
      await expect(page.getByText(copy.metadataMismatch).first()).toBeVisible();
    });
  },
);
