import {
  ROLES,
  WETH,
  antiSniperWindowSeconds,
  assertOnChain,
  buyOnChain,
  claimCreatorEth,
  collectOnChain,
  expect,
  generatePostGradFees,
  graduateToken,
  makeAddressRevert,
  parseCollectSplit,
  parseEther,
  publicClient,
  readCreatorEthClaimable,
  readCreatorOf,
  readCreatorTokenClaimable,
  readGraduatedEvent,
  sanitizeAccount,
  seedToken,
  sweepCreatorFeesOnChain,
  test,
  v3BuyExactEthConfirmed,
  warpTime,
} from "../harness";

// @flow:CFEE-3 — Un-brickable post-grad: a hostile creator can't freeze collect() or trades; only its own native-ETH claim reverts (retriable) ·
// assertable-layers: on-chain   (indexed · UI PENDING Phase-2 indexer/frontend — waiver)
//
// PENDING PHASE-2 (@pending:phase2) authored against the ratified +
// the LANDED interfaces and `test.fixme`-guarded. The creator's share is PUSHED to
// our non-reverting CreatorVault (never to the creator EOA), so a hostile /
// reverting creator can brick NOTHING on the critical path — `collect()` and every
// post-grad V3 trade still succeed, and the creator's shares still accrue safely.
// The post-grad legs are ERC20 (`claimERC20` transfers never call the creator, so a
// hostile creator can't even brick those); the pull a hostile creator DOES brick is
// the PRE-GRAD native-ETH `claim(creator)` — and it is RETRIABLE once the address is
// well-behaved again. Reuses the ERR-5 hostile-recipient `anvil_setCode` pattern (a
// fork manipulation, never a contract change), generalised to an arbitrary address.

// ALWAYS restore the hostile creator to a plain EOA (like ERR-5's restoreTreasury)
// so the reverting bytecode can't wedge later flows.
test.afterEach(async () => {
  await sanitizeAccount(ROLES.trader2.address);
});

test(
  "CFEE-3 a reverting creator cannot freeze collect() or post-grad trades — only its own native-ETH claim reverts, retriably",
  { tag: ["@flow:CFEE-3", "@layer:on-chain"] },
  async ({}) => {
    test.setTimeout(240_000);

    // The token's creator is trader2 — the address we later turn HOSTILE. The
    // buyer/collector is trader (never the hostile address).
    const creator = ROLES.trader2.address;
    const token = await seedToken({
      creator: ROLES.trader2,
      name: "Hostile Creator Coin",
      ticker: "HCRE",
    });

    // Accrue a PRE-GRAD native-ETH creator leg and sweep it into the vault, so there
    // is a native-ETH `claim` a hostile creator can brick (the post-grad legs are
    // ERC20 and don't call the creator on claim).
    await warpTime(antiSniperWindowSeconds() + 2);
    const preBuy = await buyOnChain({ buyer: ROLES.trader, token: token.token, ethWei: parseEther("0.04") });
    await publicClient.waitForTransactionReceipt({ hash: preBuy });
    const sweepHash = await sweepCreatorFeesOnChain(token.curve, ROLES.trader);
    await publicClient.waitForTransactionReceipt({ hash: sweepHash });

    await graduateToken(token.token, token.curve);
    const gradEv = await readGraduatedEvent(token.token);
    const tokenId = gradEv!.args.tokenId;

    await assertOnChain(
      "with a reverting creator: post-grad V3 trades + collect() still succeed and credit the vault; the creator's own native-ETH claim reverts, then succeeds after the address is restored",
      async () => {
        expect((await readCreatorOf(tokenId)).toLowerCase()).toBe(creator.toLowerCase());
        const preGradEthClaimable = await readCreatorEthClaimable(creator);
        expect(preGradEthClaimable > 0n).toBe(true); // the swept pre-grad native-ETH leg

        // Turn the registered creator into a hostile, reverting contract AFTER
        // registration (the mapping already captured the address).
        await makeAddressRevert(creator);

        // A post-grad V3 trade (by trader) is unaffected — the creator is never on
        // the trade path. Uses the retrying confirmed-buy: a bare `exactInputSingle`
        // intermittently reverts at INCLUSION on the block-time-2 shared fork (a venue
        // timing artifact, NOT the hostile-creator property under test), so retry to a
        // success receipt rather than let a false negative mask the real assertion.
        const swap = await v3BuyExactEthConfirmed(token.token, 3n * 10n ** 16n, ROLES.trader);
        expect(swap.status).toBe("success");

        // Generate two-sided volume + collect() — collect PUSHES the creator share
        // to the CreatorVault (not the hostile EOA), so it MUST still succeed.
        await generatePostGradFees(token.token, { by: ROLES.trader });
        const vaultWethBefore = await readCreatorTokenClaimable(creator, WETH);
        const collectHash = await collectOnChain(tokenId, ROLES.trader);
        const collectReceipt = await publicClient.waitForTransactionReceipt({ hash: collectHash });
        expect(collectReceipt.status).toBe("success");
        const collected = parseCollectSplit(collectReceipt.logs, token.token);
        // The creator's post-grad share was still credited (accrue-in-contract).
        const vaultWethAfter = await readCreatorTokenClaimable(creator, WETH);
        expect(vaultWethAfter - vaultWethBefore).toBe(collected.creatorWeth);

        // The creator's OWN native-ETH claim reverts while the address is hostile —
        // isolated to the pull, never the push path (accepts an estimate-time throw
        // OR an on-chain reverted receipt).
        let claimReverted = false;
        try {
          const h = await claimCreatorEth(creator, ROLES.trader);
          const r = await publicClient.waitForTransactionReceipt({ hash: h });
          claimReverted = r.status === "reverted";
        } catch {
          claimReverted = true;
        }
        expect(claimReverted).toBe(true);
        // The native-ETH claimable is NOT lost — still credited (retriable).
        expect(await readCreatorEthClaimable(creator)).toBe(preGradEthClaimable);

        // Restore the creator to a plain EOA → the SAME claim now succeeds.
        await sanitizeAccount(creator);
        const retryHash = await claimCreatorEth(creator, ROLES.trader);
        const retryReceipt = await publicClient.waitForTransactionReceipt({ hash: retryHash });
        expect(retryReceipt.status).toBe("success");
        expect(await readCreatorEthClaimable(creator)).toBe(0n);
      },
    );
  },
);
