/**
 * Canonical event ABI artifact freeze tests (spec §12.15-16; contracts.md §2).
 * If any of these fail after an edit, the cross-service contract changed —
 * that requires hoodpad-architect ratification, not a test update.
 */
import { describe, expect, it } from "bun:test";
import { toEventSelector, type AbiEvent } from "viem";
import {
  bondingCurveCreatorEventsAbi,
  bondingCurveEventsAbi,
  creatorFeeClaimedEvent,
  creatorFeeDepositedEvent,
  creatorFeeEventsAbi,
  creatorFeesSweptEvent,
  creatorTokenClaimedEvent,
  creatorTokenDepositedEvent,
  creatorVaultEventsAbi,
  creatorVaultTokenEventsAbi,
  curveFactoryEventsAbi,
  feesSplitEvent,
  graduatedEvent,
  lpFeeVaultSplitEventsAbi,
  postGradCreatorFeeEventsAbi,
  robbedEventsAbi,
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
    expect(robbedEventsAbi.length).toBe(6);
    for (const ev of robbedEventsAbi) expect(ev.type).toBe("event");
    // selectors are pairwise distinct
    const selectors = robbedEventsAbi.map((e) => toEventSelector(e as AbiEvent));
    expect(new Set(selectors).size).toBe(6);
  });
});

describe("creator-fee event family (spec §7 / §12.63 — ADDITIVE, kept off the frozen 6)", () => {
  it("signatures + indexed topics are transcribed from the landed artifacts", () => {
    expect(signatureOf(creatorFeesSweptEvent)).toBe("CreatorFeesSwept(address,address,uint256)");
    expect(creatorFeesSweptEvent.inputs.filter((i) => i.indexed).map((i) => i.name)).toEqual([
      "creator", "vault",
    ]);
    expect(signatureOf(creatorFeeDepositedEvent)).toBe(
      "CreatorFeeDeposited(address,address,uint256)",
    );
    expect(creatorFeeDepositedEvent.inputs.map((i) => i.name)).toEqual(["creator", "curve", "amount"]);
    expect(signatureOf(creatorFeeClaimedEvent)).toBe("CreatorFeeClaimed(address,address,uint256)");
    expect(creatorFeeClaimedEvent.inputs.map((i) => i.name)).toEqual(["creator", "caller", "amount"]);
  });

  it("does NOT contaminate the ratified six-family artifacts", () => {
    // The frozen groupings stay exactly the six families — the creator leg lives
    // in its own groupings so the ratified set can't be conflated.
    expect(bondingCurveEventsAbi).toEqual([tradeEvent]);
    expect(robbedEventsAbi.length).toBe(6);
  });

  it("Ponder groupings: curve-leg + vault source + combined manifest", () => {
    expect(bondingCurveCreatorEventsAbi).toEqual([creatorFeesSweptEvent]);
    expect(creatorVaultEventsAbi).toEqual([creatorFeeDepositedEvent, creatorFeeClaimedEvent]);
    expect(creatorFeeEventsAbi).toEqual([
      creatorFeesSweptEvent,
      creatorFeeDepositedEvent,
      creatorFeeClaimedEvent,
    ]);
    for (const ev of creatorFeeEventsAbi) expect(ev.type).toBe("event");
    // three distinct selectors, all distinct from the six ratified families
    const creatorSelectors = creatorFeeEventsAbi.map((e) => toEventSelector(e as AbiEvent));
    expect(new Set(creatorSelectors).size).toBe(3);
    const ratified = robbedEventsAbi.map((e) => toEventSelector(e as AbiEvent));
    expect(creatorSelectors.some((s) => ratified.includes(s))).toBe(false);
  });
});

describe("post-grad 50/50 LP-fee-split family (spec §12.69 — LANDED, additive)", () => {
  it("signatures + indexed topics are transcribed byte-for-byte from the regenerated artifacts", () => {
    // FeesSplit(uint256 indexed tokenId, address indexed creator, uint256 treasury0,
    //           uint256 creator0, uint256 treasury1, uint256 creator1)
    expect(signatureOf(feesSplitEvent)).toBe(
      "FeesSplit(uint256,address,uint256,uint256,uint256,uint256)",
    );
    expect(feesSplitEvent.inputs.filter((i) => i.indexed).map((i) => i.name)).toEqual([
      "tokenId", "creator",
    ]);
    expect(feesSplitEvent.inputs.map((i) => i.name)).toEqual([
      "tokenId", "creator", "treasury0", "creator0", "treasury1", "creator1",
    ]);
    // CreatorTokenDeposited(address indexed creator, address indexed token, address indexed source, uint256 amount)
    expect(signatureOf(creatorTokenDepositedEvent)).toBe(
      "CreatorTokenDeposited(address,address,address,uint256)",
    );
    expect(creatorTokenDepositedEvent.inputs.filter((i) => i.indexed).map((i) => i.name)).toEqual([
      "creator", "token", "source",
    ]);
    // CreatorTokenClaimed(address indexed creator, address indexed token, address indexed caller, uint256 amount)
    expect(signatureOf(creatorTokenClaimedEvent)).toBe(
      "CreatorTokenClaimed(address,address,address,uint256)",
    );
    expect(creatorTokenClaimedEvent.inputs.map((i) => i.name)).toEqual([
      "creator", "token", "caller", "amount",
    ]);
  });

  it("Ponder groupings: LPFeeVault split source + CreatorVault ERC20 leg + combined manifest", () => {
    expect(lpFeeVaultSplitEventsAbi).toEqual([feesSplitEvent]);
    expect(creatorVaultTokenEventsAbi).toEqual([creatorTokenDepositedEvent, creatorTokenClaimedEvent]);
    expect(postGradCreatorFeeEventsAbi).toEqual([
      feesSplitEvent,
      creatorTokenDepositedEvent,
      creatorTokenClaimedEvent,
    ]);
    for (const ev of postGradCreatorFeeEventsAbi) expect(ev.type).toBe("event");
  });

  it("selectors are distinct from the six ratified families AND the §12.63 pre-grad set", () => {
    const postGrad = postGradCreatorFeeEventsAbi.map((e) => toEventSelector(e as AbiEvent));
    expect(new Set(postGrad).size).toBe(3);
    const ratified = robbedEventsAbi.map((e) => toEventSelector(e as AbiEvent));
    const preGrad = creatorFeeEventsAbi.map((e) => toEventSelector(e as AbiEvent));
    expect(postGrad.some((s) => ratified.includes(s) || preGrad.includes(s))).toBe(false);
    // frozen six stay six; pre-grad set stays three (post-grad lives in its own groupings)
    expect(robbedEventsAbi.length).toBe(6);
    expect(creatorFeeEventsAbi.length).toBe(3);
  });
});
