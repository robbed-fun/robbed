import { formatEther, formatUnits } from "viem";
import { describe, expect, it } from "vitest";

import { mockCurveReads, mockLaunchEconomics } from "@/shared/mock/mock-api";
import { formatEthFromWei, formatEthNumber } from "@/shared/lib/format";

/**
 * Gap 1 — the demo-mode curve/factory reads that back the Trust panel's live rows
 * and the Create economics block. Proves the fixture values render to the exact
 * mockup labels (docs/Robbed.html) so no cell degrades to "on-chain read
 * unavailable" / "read on-chain" in demo mode. These helpers are ONLY invoked
 * behind `env.mockData()`; the prod read path is untouched.
 */

describe("mockCurveReads — Trust panel live rows (§5.2)", () => {
  const r = mockCurveReads();

  it("row 2: fixed 1B supply (1e27 wei)", () => {
    expect(r.totalSupply).toBe(10n ** 27n);
  });

  it("row 3: live curve reserves render as the mockup values (zero-padded)", () => {
    expect(formatEthFromWei(r.reserves.realEth)).toBe("52.7000");
  });

  it("row 4: graduation progress = realEth / threshold ⇒ 62% (mockup BONDING 62%)", () => {
    const pct =
      (Number(formatEther(r.reserves.realEth)) / Number(formatEther(r.graduationEth))) *
      100;
    expect(Math.round(pct)).toBe(62);
    expect(formatEthFromWei(r.graduationEth)).toBe("85.0000");
  });

  it("row 6: fee policy is 100 bps ⇒ 1% (mockup Fee 1%)", () => {
    expect(r.tradeFeeBps).toBe(100);
    expect(r.tradeFeeBps / 100).toBe(1);
  });
});

describe("mockLaunchEconomics — Create economics (§5.3, docs/Robbed.html §2b)", () => {
  const e = mockLaunchEconomics();

  it("Deploy cost = 0.0005 ETH", () => {
    expect(`${formatEthFromWei(e.deployFeeWei)} ETH`).toBe("0.0005 ETH");
  });

  it("Starting price = virtualEth0 / virtualToken0 ⇒ 0.0000010 ETH (mockup, trailing zero)", () => {
    const price =
      Number(formatEther(e.virtualEth0)) / Number(formatUnits(e.virtualToken0, 18));
    expect(formatEthNumber(price)).toBe("0.0000010");
  });

  it("Graduation threshold = 85 ETH", () => {
    expect(`${formatEthFromWei(e.graduationEthWei)} ETH`).toBe("85.0000 ETH");
  });

  it("Trade fee = 100 bps ⇒ 1%, creates not paused", () => {
    expect(e.tradeFeeBps).toBe(100);
    expect(e.pauseCreates).toBe(false);
  });
});
