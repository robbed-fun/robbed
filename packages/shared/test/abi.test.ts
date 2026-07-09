/**
 * Canonical event ABI artifact freeze tests (spec §12.15-16; contracts.md §2).
 * If any of these fail after an edit, the cross-service contract changed —
 * that requires hoodpad-architect ratification, not a test update.
 */
import { describe, expect, it } from "bun:test";
import { toEventSelector, type AbiEvent } from "viem";
import {
  bondingCurveEventsAbi,
  curveFactoryEventsAbi,
  graduatedEvent,
  hoodpadEventsAbi,
  launchTokenEventsAbi,
  tokenCreatedEvent,
  tradeEvent,
  transferEvent,
  v3CollectEvent,
  v3MigratorEventsAbi,
  v3PoolEventsAbi,
  v3PositionManagerEventsAbi,
  v3SwapEvent,
} from "../src/abi/events";

/** Rebuild the canonical signature from the fragment (freezes names+types+order). */
function signatureOf(ev: AbiEvent): string {
  return `${ev.name}(${ev.inputs.map((i) => i.type).join(",")})`;
}

describe("ratified signatures (spec §12.15; contracts.md §2)", () => {
  it("TokenCreated — factory (§12.15)", () => {
    expect(signatureOf(tokenCreatedEvent)).toBe(
      "TokenCreated(address,address,address,string,string,bytes32,string,address)",
    );
    expect(tokenCreatedEvent.inputs.map((i) => i.name)).toEqual([
      "token", "curve", "creator", "name", "symbol", "metadataHash", "metadataUri", "pool",
    ]);
    // first three indexed (topics), rest data
    expect(tokenCreatedEvent.inputs.map((i) => i.indexed)).toEqual([
      true, true, true, false, false, false, false, false,
    ]);
  });

  it("Trade — curve (§12.15: gross ethAmount, separate fee, post-trade reserves)", () => {
    expect(signatureOf(tradeEvent)).toBe(
      "Trade(address,bool,uint256,uint256,uint256,uint256,uint256,uint256)",
    );
    expect(tradeEvent.inputs.map((i) => i.name)).toEqual([
      "trader", "isBuy", "ethAmount", "tokenAmount", "fee",
      "virtualEthReserves", "virtualTokenReserves", "realEthReserves",
    ]);
    expect(tradeEvent.inputs.filter((i) => i.indexed).map((i) => i.name)).toEqual([
      "trader", "isBuy",
    ]);
  });

  it("Graduated — migrator (contracts.md §2.5)", () => {
    expect(signatureOf(graduatedEvent)).toBe(
      "Graduated(address,address,uint256,uint128,uint256,uint256,uint256,address,uint256,uint256,uint256)",
    );
    expect(graduatedEvent.inputs.filter((i) => i.indexed).map((i) => i.name)).toEqual([
      "token", "pool", "tokenId",
    ]);
  });

  it("Collect — NPM (indexer.md §3.5)", () => {
    expect(signatureOf(v3CollectEvent)).toBe("Collect(uint256,address,uint256,uint256)");
    expect(v3CollectEvent.inputs.filter((i) => i.indexed).map((i) => i.name)).toEqual(["tokenId"]);
  });
});

describe("canonical upstream topic0 (stable, well-known selectors)", () => {
  it("ERC-20 Transfer (sixth event family, §12.16)", () => {
    expect(toEventSelector(transferEvent)).toBe(
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    );
  });

  it("Uniswap V3 Swap", () => {
    expect(toEventSelector(v3SwapEvent)).toBe(
      "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
    );
  });
});

describe("artifact groupings (one source for Ponder config + frontend decoding)", () => {
  it("per-contract slices contain exactly the ratified fragments", () => {
    expect(curveFactoryEventsAbi).toEqual([tokenCreatedEvent]);
    expect(bondingCurveEventsAbi).toEqual([tradeEvent]);
    expect(v3MigratorEventsAbi).toEqual([graduatedEvent]);
    expect(launchTokenEventsAbi).toEqual([transferEvent]);
    expect(v3PoolEventsAbi).toEqual([v3SwapEvent]);
    expect(v3PositionManagerEventsAbi).toEqual([v3CollectEvent]);
  });

  it("combined artifact covers the six ratified event families (§12.15-16), all type:'event'", () => {
    expect(hoodpadEventsAbi.length).toBe(6);
    for (const ev of hoodpadEventsAbi) expect(ev.type).toBe("event");
    // selectors are pairwise distinct
    const selectors = hoodpadEventsAbi.map((e) => toEventSelector(e as AbiEvent));
    expect(new Set(selectors).size).toBe(6);
  });
});
