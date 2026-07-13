import {
  ROLES,
  assertOnChain,
  graduateToken,
  expect,
  publicClient,
  readCreatorOf,
  readGraduatedEvent,
  registerCreatorAs,
  seedToken,
  test,
} from "../harness";

// @flow:CFEE-4 — Set-once, unspoofable creator registration (tokenId → creator) · §12.69(B)
// assertable-layers: on-chain   (indexed · UI N/A — a contract-level mapping invariant — waiver)
//
// PENDING PHASE-2 (@pending:phase2): authored against the ratified §12.69(B) —
// the migrator registers `tokenId → creator` at graduation, set-once + migrator-
// authenticated — and `test.fixme`-guarded. This is a pure on-chain invariant: a
// NON-migrator caller can neither set nor overwrite the mapping, and the recorded
// creator equals the graduating curve's creator. Uses the §12.69 stub surface
// (`creatorOf` / migrator-gated `registerCreator`) — reconcile names at un-skip.
test(
  "CFEE-4 creatorOf(tokenId) equals the true creator and a non-migrator cannot spoof or overwrite it",
  { tag: ["@flow:CFEE-4", "@layer:on-chain"] },
  async ({}) => {
    test.setTimeout(180_000);

    const creator = ROLES.creator.address;
    const attacker = ROLES.trader2;
    const token = await seedToken({ creator: ROLES.creator, name: "Register Coin", ticker: "RGST" });
    await graduateToken(token.token, token.curve);
    const gradEv = await readGraduatedEvent(token.token);
    const tokenId = gradEv!.args.tokenId;

    await assertOnChain(
      "the mapping is captured correctly at graduation and is set-once + migrator-gated against any non-migrator caller",
      async () => {
        // Captured at the authoritative moment = the graduating curve's creator.
        expect((await readCreatorOf(tokenId)).toLowerCase()).toBe(creator.toLowerCase());

        // A NON-migrator attempt to OVERWRITE the existing mapping must revert
        // (`NotMigrator` and/or set-once `CreatorAlreadyRegistered`, ILPFeeVault) —
        // accepts an estimate-time throw OR a reverted receipt.
        let overwriteReverted = false;
        try {
          const h = await registerCreatorAs(tokenId, attacker.address, attacker);
          const r = await publicClient.waitForTransactionReceipt({ hash: h });
          overwriteReverted = r.status === "reverted";
        } catch {
          overwriteReverted = true;
        }
        expect(overwriteReverted).toBe(true);
        // The mapping is UNCHANGED — the spoof never took.
        expect((await readCreatorOf(tokenId)).toLowerCase()).toBe(creator.toLowerCase());

        // A NON-migrator attempt to register a FRESH (never-graduated) tokenId must
        // also revert (`NotMigrator`) — only the trusted migrator may write.
        const unusedTokenId = tokenId + 10_000n;
        let freshReverted = false;
        try {
          const h = await registerCreatorAs(unusedTokenId, attacker.address, attacker);
          const r = await publicClient.waitForTransactionReceipt({ hash: h });
          freshReverted = r.status === "reverted";
        } catch {
          freshReverted = true;
        }
        expect(freshReverted).toBe(true);
      },
    );
  },
);
