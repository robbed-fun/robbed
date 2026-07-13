import { launchTokenAbi } from "@robbed/shared/abi";

import {
  api,
  assertIndexed,
  assertOnChain,
  canProvisionMismatchFixture,
  expect,
  publicClient,
  seedMismatchToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:ERR-6b — Metadata mismatch verdict (server-side; §8.3)
//
// RE-SCOPED 2026-07-13 (USER-DIRECTED §12.57 SafetyStrip removal) — FLAGGED FOR
// ARCHITECT RATIFICATION (robbed-e2e; NOT self-ratified):
//   The metadata-verdict UI surface — the deleted SafetyStrip's `MetadataTick`
//   red "Metadata MISMATCH" state — no longer exists anywhere on token detail.
//   The verdict is STILL computed server-side (the indexer's metadata-hash
//   verification, exposed on `GET /v1/tokens/:address` as
//   `trust.metadataVerification`), but it has no token-detail UI home.
//
//   So the assertion re-homes to the surviving layers: the immutable on-chain
//   committed `metadataHash` (ground truth) and the indexer's MISMATCH verdict
//   read directly over REST. The UI leg is DROPPED — there is no rendered
//   surface left to assert. This preserves the meaningful proof (verdict is
//   real, never client-overridden) while dropping only the vanished display.
//
//   LAYER CHANGE: on-chain · indexed · UI  →  on-chain · indexed (UI waived).
//   Awaiting robbed-architect §12 ratification (coordinate with the §12.57
//   amendment removing the SafetyStrip's metadata tick).
//
// Fixture: a token whose ON-CHAIN committed metadataHash ≠ the keccak of its
// stored canonical JSON. SELF-PROVISIONED by the harness (seedMismatchToken:
// pin → tamper the stored object via minio `mc` → createToken committing the
// original hash), so no dev:seed dependency remains. `E2E_MISMATCH_TOKEN`
// still wins when supplied (remote stacks without docker access).
//
// assertable-layers: on-chain · indexed  (UI waived — see user-flows-waivers.md)
test(
  "ERR-6b indexer materializes the ⚠ MISMATCH verdict for changed metadata (server-side, never overridden)",
  { tag: ["@flow:ERR-6b", "@layer:on-chain", "@layer:indexed"] },
  async () => {
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

    await assertIndexed("the indexer's verdict is MISMATCH (computed ≠ on-chain)", async () => {
      const t = await waitForIndexed(
        () => api.token(token!),
        (t: any) => t?.trust?.metadataVerification?.status === "mismatch",
        { label: "mismatch verdict", timeoutMs: 90_000, intervalMs: 2_000 },
      );
      expect(t.trust.metadataVerification.computedHash).not.toBe(
        t.trust.metadataVerification.onchainHash,
      );
    });
  },
);
