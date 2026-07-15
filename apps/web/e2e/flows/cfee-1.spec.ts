import { graduatedEvent } from "@robbed/shared/abi";
import { parseEventLogs } from "viem";

import {
  EXPECTED_CREATOR_LP_SHARE_BPS,
  ROLES,
  WETH,
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  connectAs,
  collectOnChain,
  expect,
  generatePostGradFees,
  graduateToken,
  parseCollectSplit,
  portfolio,
  publicClient,
  readCreatorLpShareBps,
  readCreatorOf,
  readCreatorTokenClaimable,
  readTokenBalance,
  seedToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:CFEE-1 — Post-grad creator-fee accrual + claim (LP-fee 50/50 split → CreatorVault → claim) ·
// assertable-layers: on-chain · indexed · UI
//
// WIDENED 2026-07-13 (creator-fee generation DEPLOYED to the fork) the /
// factory generation is live, so this un-skips and widens from on-chain-only
// to on-chain · INDEXED. The indexed leg polls the split roll-up the indexer now
// materializes (`GET /v1/creators/:creator/claimable/:token`, authoritative live
// `CreatorVault.tokenBalanceOf` over the `creator_token_claimable` accrual) and
// reconciles it to the on-chain vault credit. CreatorEarningsPanel now enumerates
// post-grad buckets through `GET /v1/creators/:a/token-claimable`; the UI leg below
// proves the Portfolio CREATED claim buttons submit the pull-payment txs.
//
// Routing (LPFeeVault._route): BOTH post-grad legs (the launch token AND WETH) are
// credited to the creator as ERC20 via `depositERC20` per `(creator, token)` —
// nothing unwrapped — and the treasury share is `safeTransfer`'d as ERC20
// (treasury-first, keeps the odd wei).
test(
  "CFEE-1 post-grad V3 fees split 50/50 → creator token+WETH legs land in the CreatorVault, are indexed, and are claimable",
  { tag: ["@flow:CFEE-1", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    test.setTimeout(240_000);

    const creator = ROLES.creator.address;
    const token = await seedToken({
      creator: ROLES.creator,
      name: "Creator Fee Coin",
      ticker: "CFEE",
    });
    const gradHash = await graduateToken(token.token, token.curve);
    const gradReceipt = await publicClient.getTransactionReceipt({ hash: gradHash });
    const [graduated] = parseEventLogs({
      abi: [graduatedEvent],
      logs: gradReceipt.logs,
      eventName: "Graduated",
    });
    const tokenId = graduated!.args.tokenId;

    // Carried from the on-chain split assertion into the indexed + claim steps.
    let creatorTokCredit = 0n;
    let creatorWethStanding = 0n;
    let vaultTokenBalance = 0n;

    await assertOnChain(
      "collect() splits post-grad V3 fees 50/50; the creator's token+WETH legs (both ERC20) land in the CreatorVault; treasury takes the other 50%",
      async () => {
        // The migrator registered tokenId → creator at graduation (B),
        // and the vault's split is the 50/50 immutable (A).
        expect((await readCreatorOf(tokenId)).toLowerCase()).toBe(creator.toLowerCase());
        const shareBps = await readCreatorLpShareBps();
        expect(shareBps).toBe(EXPECTED_CREATOR_LP_SHARE_BPS);

        // Generate REAL two-sided post-grad V3 volume so BOTH legs accrue a fee
        // (a WETH-in buy → WETH-leg, a token-in sell → token-leg).
        await generatePostGradFees(token.token, { by: ROLES.trader2 });

        // Both legs land in the CreatorVault as ERC20, per (creator, token).
        const creatorWethBefore = await readCreatorTokenClaimable(creator, WETH);
        const creatorTokBefore = await readCreatorTokenClaimable(creator, token.token);
        const treasuryWethBefore = await readTokenBalance(ROLES.treasury.address, WETH);
        const treasuryTokBefore = await readTokenBalance(ROLES.treasury.address, token.token);

        // Permissionless split collect() — the vault routes the treasury share
        // to the fixed treasury and the creator share to the CreatorVault (creatorOf).
        const collectHash = await collectOnChain(tokenId, ROLES.trader);
        const collectReceipt = await publicClient.waitForTransactionReceipt({ hash: collectHash });
        expect(collectReceipt.status).toBe("success");
        const collected = parseCollectSplit(collectReceipt.logs, token.token);
        // A two-sided volume must have produced a fee in at least one leg.
        expect(collected.wethLeg + collected.tokenLeg > 0n).toBe(true);

        // : the FeesSplit sums EXACTLY to the collected amount per leg —
        // no leakage / rounding drain — and the beneficiary is the creator.
        expect(collected.creator.toLowerCase()).toBe(creator.toLowerCase());
        expect(collected.creatorWeth + collected.treasuryWeth).toBe(collected.wethLeg);
        expect(collected.creatorToken + collected.treasuryToken).toBe(collected.tokenLeg);
        // : the creator share is the immutable 50/50 of each leg (floor; the
        // treasury keeps the odd wei — treasury-first in `_route`).
        expect(collected.creatorWeth).toBe((collected.wethLeg * BigInt(shareBps)) / 10_000n);
        expect(collected.creatorToken).toBe((collected.tokenLeg * BigInt(shareBps)) / 10_000n);

        // The creator's cut landed in the CreatorVault ERC20 buckets (both legs);
        // the treasury received the complementary ERC20 shares directly.
        const creatorWethCredit = (await readCreatorTokenClaimable(creator, WETH)) - creatorWethBefore;
        creatorTokCredit = (await readCreatorTokenClaimable(creator, token.token)) - creatorTokBefore;
        expect(creatorWethCredit).toBe(collected.creatorWeth);
        expect(creatorTokCredit).toBe(collected.creatorToken);
        expect((await readTokenBalance(ROLES.treasury.address, WETH)) - treasuryWethBefore).toBe(
          collected.treasuryWeth,
        );
        expect(
          (await readTokenBalance(ROLES.treasury.address, token.token)) - treasuryTokBefore,
        ).toBe(collected.treasuryToken);

        // Standing balances (pre-claim), read on-chain for the indexed reconcile below.
        vaultTokenBalance = await readCreatorTokenClaimable(creator, token.token);
        creatorWethStanding = await readCreatorTokenClaimable(creator, WETH);
        expect(vaultTokenBalance).toBe(creatorTokCredit); // fresh token → no residual
        expect(creatorWethStanding >= creatorWethCredit).toBe(true); // WETH aggregates
      },
    );

    await assertIndexed(
      "the indexer materializes the split roll-up; the claimable API reconciles to the on-chain vault credit (both legs)",
      async () => {
        // The token-leg bucket (`creator_token_claimable` roll-up) surfaces the
        // AUTHORITATIVE live `tokenBalanceOf(creator, token)` over REST — poll until
        // the indexer has caught the CreatorTokenDeposited from this collect.
        const tokLeg = await waitForIndexed(
          () => api.creatorTokenClaimable(creator, token.token),
          (d) => BigInt(d.claimable) === vaultTokenBalance && vaultTokenBalance > 0n,
          { label: "token-leg claimable indexed", timeoutMs: 30_000 },
        );
        expect(tokLeg.creator.toLowerCase()).toBe(creator.toLowerCase());
        expect(tokLeg.token.toLowerCase()).toBe(token.token.toLowerCase());
        expect(BigInt(tokLeg.claimable)).toBe(creatorTokCredit);

        // The aggregated WETH-leg bucket reconciles to the standing on-chain balance.
        const wethLeg = await waitForIndexed(
          () => api.creatorTokenClaimable(creator, WETH),
          (d) => BigInt(d.claimable) === creatorWethStanding && creatorWethStanding > 0n,
          { label: "weth-leg claimable indexed", timeoutMs: 30_000 },
        );
        expect(wethLeg.token.toLowerCase()).toBe(WETH.toLowerCase());
        expect(BigInt(wethLeg.claimable)).toBe(creatorWethStanding);
      },
    );

    let creatorWethWalletBefore = 0n;
    let creatorTokWalletBefore = 0n;

    await assertUi(
      "the creator claims both post-grad buckets from Portfolio → CREATED",
      async () => {
        await page.goto(portfolio.route());
        await connectAs(page, "creator");
        await portfolio.createdTab(page).click();

        await expect(page.getByText("Creator earnings").first()).toBeVisible({
          timeout: 30_000,
        });

        const claimWeth = page.getByRole("button", { name: /^Claim WETH$/i }).first();
        const claimToken = page
          .getByRole("button", { name: new RegExp(`^Claim ${token.ticker}$`, "i") })
          .first();

        await expect(claimWeth).toBeVisible({ timeout: 30_000 });
        await expect(claimToken).toBeVisible({ timeout: 30_000 });

        // WETH leg: `claimERC20(creator, WETH)` drains the WHOLE standing (aggregated)
        // balance; the follow-up on-chain marker asserts the wallet delta.
        creatorWethWalletBefore = await readTokenBalance(creator, WETH);
        await claimWeth.click();
        await expect
          .poll(() => readCreatorTokenClaimable(creator, WETH), {
            message: "WETH creator-fee bucket drains after the Portfolio claim",
            timeout: 60_000,
          })
          .toBe(0n);

        // Token leg: unique per token → the claim delivers exactly this collect's credit.
        creatorTokWalletBefore = await readTokenBalance(creator, token.token);
        await claimToken.click();
        await expect
          .poll(() => readCreatorTokenClaimable(creator, token.token), {
            message: "launch-token creator-fee bucket drains after the Portfolio claim",
            timeout: 60_000,
          })
          .toBe(0n);
      },
    );

    await assertOnChain(
      "the UI-submitted creator PULLS deliver both ERC20 legs to the creator wallet",
      async () => {
        expect((await readTokenBalance(creator, WETH)) - creatorWethWalletBefore).toBe(
          creatorWethStanding,
        );
        expect((await readTokenBalance(creator, token.token)) - creatorTokWalletBefore).toBe(
          creatorTokCredit,
        );
        expect(await readCreatorTokenClaimable(creator, WETH)).toBe(0n);
        expect(await readCreatorTokenClaimable(creator, token.token)).toBe(0n);
      },
    );
  },
);
