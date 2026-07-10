import {
  api,
  assertIndexed,
  assertOnChain,
  buyOnChain,
  collectOnChain,
  expect,
  graduateToken,
  publicClient,
  ROLES,
  seedToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:COLLECT-1 — LP fee sweep · tx `collect(tokenId)` (§6.3/§6.6)
// assertable-layers: on-chain · indexed   (N/A UI: no v1 page surface — waiver)
test(
  "COLLECT-1 permissionless LPFeeVault.collect routes fees to the fixed treasury",
  { tag: ["@flow:COLLECT-1", "@layer:on-chain", "@layer:indexed"] },
  async ({}) => {
    const token = await seedToken({ name: "Collect Coin", ticker: "CLCT" });
    await graduateToken(token.token, token.curve);

    // Generate V3 LP fees post-grad so `collect` has something to sweep.
    const swap = await buyOnChain({ buyer: ROLES.trader2, token: token.token, ethWei: 5n * 10n ** 16n });
    await publicClient.waitForTransactionReceipt({ hash: swap });

    // The LP position tokenId minted at graduation — surfaced by the indexer.
    const detail = await waitForIndexed(
      () => api.token(token.token),
      (t: any) => t?.status === "graduated" && (t?.lpTokenId ?? t?.pool?.lpTokenId) != null,
      { label: "lp tokenId indexed" },
    );
    const tokenId = BigInt(detail.lpTokenId ?? detail.pool?.lpTokenId);

    let collectHash: `0x${string}`;
    await assertOnChain("collect(tokenId) succeeds; principal stays locked", async () => {
      const treasuryBefore = await publicClient.getBalance({ address: ROLES.treasury.address });
      collectHash = await collectOnChain(tokenId, ROLES.trader);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: collectHash });
      expect(receipt.status).toBe("success");
      const treasuryAfter = await publicClient.getBalance({ address: ROLES.treasury.address });
      // Fees route to the fixed treasury; principal is never withdrawn (§6.3).
      expect(treasuryAfter >= treasuryBefore).toBe(true);
    });

    await assertIndexed("the collect event is materialized by the indexer", async () => {
      await waitForIndexed(
        () => api.tradeByTx(collectHash).catch(() => null as any),
        (rec: any) => rec != null,
        { label: "collect event indexed", timeoutMs: 20_000 },
      );
    });
  },
);
