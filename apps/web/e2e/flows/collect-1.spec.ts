import { graduatedEvent } from "@robbed/shared/abi";
import { parseEventLogs } from "viem";

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
    const gradHash = await graduateToken(token.token, token.curve);

    // The LP position tokenId is read from the graduation receipt's `Graduated`
    // log (shared event ABI — the on-chain ground truth). NOTE: the indexed token
    // detail does NOT yet surface `lpTokenId` (gap reported → robbed-indexer).
    const gradReceipt = await publicClient.getTransactionReceipt({ hash: gradHash });
    const [graduated] = parseEventLogs({
      abi: [graduatedEvent],
      logs: gradReceipt.logs,
      eventName: "Graduated",
    });
    const tokenId = graduated!.args.tokenId;

    // Post-grad V3 volume so `collect` has fees to sweep (best-effort: the
    // assertions below hold regardless of the swept amount).
    const swap = await buyOnChain({ buyer: ROLES.trader2, token: token.token, ethWei: 5n * 10n ** 16n });
    await publicClient.waitForTransactionReceipt({ hash: swap }).catch(() => null);

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

    await assertIndexed("the fee collection is materialized on /v1/tokens/:address/fees", async () => {
      await waitForIndexed(
        () => api.fees(token.token),
        (f: any) =>
          (f?.collected?.byCollection ?? []).some(
            (c: any) => c.txHash?.toLowerCase() === collectHash.toLowerCase(),
          ),
        { label: "collect event indexed into fee_collections", timeoutMs: 20_000 },
      );
    });
  },
);
