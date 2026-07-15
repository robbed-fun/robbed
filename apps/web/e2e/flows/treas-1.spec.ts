import { type Address, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  type GraduatedLog,
  ROLES,
  TREASURY_SAFE_OWNERS,
  TREASURY_SAFE_THRESHOLD,
  WETH,
  assertOnChain,
  buildSafeErc20TransferTx,
  claimCreatorEth,
  claimCreatorToken,
  collectOnChain,
  createTokenOnChain,
  crossGraduationThreshold,
  deployFeeWei,
  ensureCreatesEnabled,
  erc20BalanceOf,
  execSafeWithdrawal,
  expect,
  generatePostGradFees,
  graduateOnChain,
  installTreasurySafe,
  loadDeployedAddresses,
  localMetadata,
  parseCollectSplit,
  publicClient,
  readCreatorEthClaimable,
  readCreatorTokenClaimable,
  readCurvePhase,
  readGraduatedEvent,
  readLpFeeVaultTreasury,
  readSafeMeta,
  readTokenBalance,
  sanitizeDevAccounts,
  signAndAssembleSafeTx,
  sweepCreatorFeesOnChain,
  test,
} from "../harness";

/**
 * On-chain-ONLY seed + graduate (never waits on the indexer). TREAS-1 declares
 * `on-chain` only, so it must be executable — and re-run-stable — regardless of
 * indexer availability: create the token straight on-chain, cross the graduation
 * threshold (keeper-safe), and poll the on-chain `Graduated` event (the compose
 * keeper fires it, or we do), never a REST/`waitForIndexed` read.
 */
async function seedGraduatedOnChain(
  name: string,
  ticker: string,
): Promise<{ token: Address; curve: Address; grad: GraduatedLog }> {
  await sanitizeDevAccounts();
  await ensureCreatesEnabled();
  const tag = Math.random().toString(36).slice(2, 5).toUpperCase();
  const md = localMetadata({ name: `${name} ${tag}`, ticker: `${ticker.slice(0, 7)}${tag}` });
  const created = await createTokenOnChain({
    creator: ROLES.creator,
    name: `${name} ${tag}`,
    symbol: `${ticker.slice(0, 7)}${tag}`,
    metadataHash: md.metadataHash,
    metadataUri: md.metadataUri,
    deployFeeWei: deployFeeWei(),
  });
  const phase = await crossGraduationThreshold(created.token, created.curve);
  if (phase === "ready") {
    await graduateOnChain(created.curve)
      .then((h) => publicClient.waitForTransactionReceipt({ hash: h }))
      .catch(() => {}); // tolerate NotReady if the keeper won the race
  }
  const deadline = Date.now() + 90_000;
  let grad = await readGraduatedEvent(created.token);
  while (!grad && Date.now() < deadline) {
    if ((await readCurvePhase(created.curve)) === "ready") {
      await graduateOnChain(created.curve)
        .then((h) => publicClient.waitForTransactionReceipt({ hash: h }))
        .catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 1_500));
    grad = await readGraduatedEvent(created.token);
  }
  if (!grad) throw new Error("[e2e] TREAS-1 token did not graduate on-chain within 90s");
  return { token: created.token, curve: created.curve, grad };
}

// @flow:TREAS-1 — Post-grad fee WITHDRAWAL: creator pulls its CreatorVault legs
// AND the 2-of-4 treasury Safe withdraws its collected fee share.
// assertable-layers: on-chain   (indexed · UI waived — see waivers)
//
// Placed after the post-grad V3 swap step (TD-5): once graduation + V3 volume has
// accrued fees and `collect()` has split them, this proves BOTH withdrawal paths
// end-to-end in ONE graduation flow —
//   (1) CREATOR: claimERC20(creator, WETH)/(creator, token) for the post-grad legs
//       (+ claim(creator) for the pre-grad native-ETH curve leg when present), the
//       creator's wallet balances rising and the vault buckets draining to zero; and
//   (2) TREASURY (the new part): the treasury is a canonical 2-of-4 Gnosis Safe
//       v1.4.1 on the fork (installTreasurySafe wires the deployed contracts'
//       IMMUTABLE treasury address to a real Safe — see harness/safe.ts). After
//       collect() PUSHES the treasury's ERC20 fee share into the Safe, a 2-of-4
//       `execTransaction` (2 of the 4 owner signatures, ascending) moves it OUT to a
//       recipient (recipient up, Safe down), and the SAME withdrawal with a SINGLE
//       signature REVERTS (below threshold, nonce unchanged).
//
// On-chain only: the treasury Safe `execTransaction` has no indexer/UI surface (the
// indexer does not watch the Safe; treasury tooling has no v1 page — cf. COLLECT-1's
// UI waiver + CFEE-3/CFEE-4 on-chain-only invariants), and the creator-claim indexed
// drain is already asserted by CFEE-1. See user-flows-waivers.md.
test(
  "TREAS-1 creator pulls its CreatorVault legs and a 2-of-4 treasury Safe withdraws its fee share (single-sig reverts)",
  { tag: ["@flow:TREAS-1", "@layer:on-chain"] },
  async ({}) => {
    test.setTimeout(240_000);

    const creator = ROLES.creator.address;
    // On-chain-only seed + graduate (no indexer dependency — TREAS-1 is on-chain only).
    const { token, curve, grad } = await seedGraduatedOnChain("Treasury Withdraw Coin", "TREAS");
    const tokenId = grad.args.tokenId;

    // Values carried across the steps.
    let safe = getAddress(loadDeployedAddresses().treasury);
    let treasuryWethShare = 0n;
    let treasuryTokShare = 0n;
    let creatorWethStanding = 0n;
    let creatorTokCredit = 0n;

    const safeWethBeforeVolume = await erc20BalanceOf(WETH, safe);
    const safeTokBeforeVolume = await erc20BalanceOf(token, safe);
    const creatorWethBeforeVolume = await readCreatorTokenClaimable(creator, WETH);
    const creatorTokBeforeVolume = await readCreatorTokenClaimable(creator, token);

    // Generate two-sided post-grad V3 volume so collect() has fees to split in BOTH
    // legs; sweep the pre-grad curve creator leg into the CreatorVault.
    await generatePostGradFees(token, { by: ROLES.trader2 });
    await sweepCreatorFeesOnChain(curve, ROLES.trader)
      .then((h) => publicClient.waitForTransactionReceipt({ hash: h }))
      .catch(() => {}); // best-effort: only accrues an ETH leg if the curve had creator fees

    await assertOnChain(
      "the deployed contracts' immutable treasury address is wired to a canonical 2-of-4 Safe v1.4.1",
      async () => {
        // The install target is the LIVE immutable LPFeeVault.treasury() (never assumed).
        const treasury = await readLpFeeVaultTreasury();
        expect(treasury).toBe(getAddress(loadDeployedAddresses().treasury));
        safe = treasury;

        const meta = await installTreasurySafe(treasury);
        expect(meta.version).toBe("1.4.1");
        expect(meta.threshold).toBe(TREASURY_SAFE_THRESHOLD); // 2
        expect(meta.owners.length).toBe(4);
        const wantOwners = new Set(
          TREASURY_SAFE_OWNERS.map((o) => getAddress(o.address).toLowerCase()),
        );
        expect(meta.owners.every((o) => wantOwners.has(o.toLowerCase()))).toBe(true);
        // It really is a live Safe (VERSION/threshold read back through the proxy).
        expect((await readSafeMeta(treasury))?.threshold).toBe(TREASURY_SAFE_THRESHOLD);
      },
    );

    await assertOnChain(
      "collect() splits the post-grad fees; the treasury's ERC20 share lands in the Safe; the creator's legs land in the CreatorVault",
      async () => {
        const safeWethBefore = await erc20BalanceOf(WETH, safe);
        const safeTokBefore = await erc20BalanceOf(token, safe);
        const creatorWethBefore = await readCreatorTokenClaimable(creator, WETH);
        const creatorTokBefore = await readCreatorTokenClaimable(creator, token);

        const collectHash = await collectOnChain(tokenId, ROLES.trader);
        const collectReceipt = await publicClient.waitForTransactionReceipt({ hash: collectHash });
        expect(collectReceipt.status).toBe("success");
        const split = parseCollectSplit(collectReceipt.logs, token);

        const safeWethAfter = await erc20BalanceOf(WETH, safe);
        const safeTokAfter = await erc20BalanceOf(token, safe);
        const creatorWethAfter = await readCreatorTokenClaimable(creator, WETH);
        const creatorTokAfter = await readCreatorTokenClaimable(creator, token);
        treasuryWethShare = safeWethAfter - safeWethBeforeVolume;
        treasuryTokShare = safeTokAfter - safeTokBeforeVolume;

        // The treasury share was PUSHED (ERC20 safeTransfer) into the Safe.
        // The compose keeper may collect first, so the manual collect receipt is a
        // lower bound on this run's total credited WETH share.
        expect(treasuryWethShare).toBeGreaterThan(0n);
        expect(safeWethAfter - safeWethBefore).toBeGreaterThanOrEqual(split.treasuryWeth);
        expect(safeTokAfter - safeTokBefore).toBeGreaterThanOrEqual(split.treasuryToken);

        // The creator's post-grad legs were credited to its CreatorVault buckets.
        creatorWethStanding = creatorWethAfter;
        creatorTokCredit = creatorTokAfter - creatorTokBeforeVolume;
        expect(creatorWethAfter - creatorWethBefore).toBeGreaterThanOrEqual(split.creatorWeth);
        expect(creatorTokAfter - creatorTokBefore).toBeGreaterThanOrEqual(split.creatorToken);
        expect(creatorWethAfter - creatorWethBeforeVolume).toBeGreaterThan(0n);
        expect(creatorTokCredit).toBeGreaterThan(0n);
      },
    );

    await assertOnChain(
      "CREATOR withdrawal — the creator pulls both ERC20 legs (+ the native-ETH curve leg if present); buckets drain",
      async () => {
        // WETH leg: claimERC20 drains the whole standing (aggregated) bucket.
        const creatorWethWalletBefore = await readTokenBalance(creator, WETH);
        const claimWethHash = await claimCreatorToken(creator, WETH, ROLES.trader);
        expect((await publicClient.waitForTransactionReceipt({ hash: claimWethHash })).status).toBe(
          "success",
        );
        expect((await readTokenBalance(creator, WETH)) - creatorWethWalletBefore).toBe(
          creatorWethStanding,
        );
        expect(await readCreatorTokenClaimable(creator, WETH)).toBe(0n);

        // Token leg: unique per token → the claim delivers exactly this collect's credit.
        const creatorTokWalletBefore = await readTokenBalance(creator, token);
        const claimTokHash = await claimCreatorToken(creator, token, ROLES.trader);
        expect((await publicClient.waitForTransactionReceipt({ hash: claimTokHash })).status).toBe(
          "success",
        );
        expect((await readTokenBalance(creator, token)) - creatorTokWalletBefore).toBe(
          creatorTokCredit,
        );
        expect(await readCreatorTokenClaimable(creator, token)).toBe(0n);

        // Pre-grad native-ETH curve leg (if the sweep accrued one) — pull it too.
        const ethClaimable = await readCreatorEthClaimable(creator);
        if (ethClaimable > 0n) {
          const creatorEthBefore = await publicClient.getBalance({ address: creator });
          const claimEthHash = await claimCreatorEth(creator, ROLES.trader); // funds go to creator; trader pays gas
          expect(
            (await publicClient.waitForTransactionReceipt({ hash: claimEthHash })).status,
          ).toBe("success");
          expect(await readCreatorEthClaimable(creator)).toBe(0n);
          const creatorEthDelta =
            (await publicClient.getBalance({ address: creator })) - creatorEthBefore;
          // The contract invariant is the vault drain; the shared dev creator can
          // have unrelated balance movement when e2e flows overlap, so avoid exact
          // native-balance equality here. The permissionless claim must still pay a
          // positive amount and cannot mint more than the drained claimable.
          expect(creatorEthDelta).toBeGreaterThan(0n);
          expect(creatorEthDelta).toBeLessThanOrEqual(ethClaimable);
        }
      },
    );

    await assertOnChain(
      "TREASURY 2-of-4 withdrawal — 2 owner signatures move the Safe's WETH fee share OUT; recipient up, Safe down, nonce++",
      async () => {
        const recipient = getAddress(privateKeyToAccount(generatePrivateKey()).address);
        const safeWethBefore = await erc20BalanceOf(WETH, safe);
        // The Safe holds at least this run's treasury WETH share; withdraw it all.
        expect(safeWethBefore).toBeGreaterThanOrEqual(treasuryWethShare);
        expect(safeWethBefore).toBeGreaterThan(0n);
        const nonceBefore = (await readSafeMeta(safe))!.nonce;

        const tx = await buildSafeErc20TransferTx(
          safe,
          WETH,
          recipient,
          safeWethBefore,
          nonceBefore,
        );
        // 2 of the 4 owners sign (ascending — the only order the Safe accepts).
        const blob = await signAndAssembleSafeTx(
          safe,
          tx,
          TREASURY_SAFE_OWNERS.slice(0, 2),
          "ascending",
        );
        const res = await execSafeWithdrawal(safe, tx, blob, ROLES.trader);
        expect(res.executionSuccess).toBe(true);

        // Recipient credited exactly; the Safe's WETH drained; nonce advanced by one.
        expect(await erc20BalanceOf(WETH, recipient)).toBe(safeWethBefore);
        expect(await erc20BalanceOf(WETH, safe)).toBe(0n);
        expect((await readSafeMeta(safe))!.nonce).toBe(nonceBefore + 1n);
      },
    );

    await assertOnChain(
      "THRESHOLD enforcement — the SAME withdrawal with a SINGLE signature REVERTS (below threshold); nonce unchanged",
      async () => {
        const recipient = getAddress(privateKeyToAccount(generatePrivateKey()).address);
        const nonceBefore = (await readSafeMeta(safe))!.nonce;
        // A tiny token-leg transfer at the live nonce with ONE owner signature.
        const one = treasuryTokShare > 1n ? 1n : treasuryTokShare;
        const tx = await buildSafeErc20TransferTx(safe, token, recipient, one, nonceBefore);
        const blob = await signAndAssembleSafeTx(safe, tx, [TREASURY_SAFE_OWNERS[0]!], "none");

        // Below-threshold → the Safe reverts (execSafeWithdrawal simulates first, so
        // the bad blob throws BEFORE any gas is spent).
        await expect(execSafeWithdrawal(safe, tx, blob, ROLES.trader)).rejects.toThrow();

        // No partial execution: the Safe nonce is UNCHANGED and no tokens moved.
        expect((await readSafeMeta(safe))!.nonce).toBe(nonceBefore);
        expect(await erc20BalanceOf(token, recipient)).toBe(0n);
      },
    );
  },
);
