/**
 * address_pnl roll-up suite (portfolio; db-rows `AddressPnlRow`). Drives
 * the PURE `rollUpAddressPnl` + `realizedForLeg` — the same code the roll-up job
 * runs. Advisory ONLY: asserts realized ranges + confidence + aggregation; there
 * is no code path that gates a trade/listing on any of it.
 */
import { describe, expect, it } from "bun:test";
import {
  realizedForLeg,
  rollUpAddressPnl,
  type PnlInput,
  type PnlLegRow,
} from "../src/pnl/compute";

const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const ZERO = "0x0000000000000000000000000000000000000000";
const ETH = 10n ** 18n;

const emptyInput = (): PnlInput => ({ legs: [], activity: [], seen: [], created: [] });

/** Curve-only leg helper: buys/sells with zero fee for clean arithmetic. */
function curveLeg(
  address: string,
  token: string,
  ethIn: bigint,
  bought: bigint,
  ethOut: bigint,
  sold: bigint,
): PnlLegRow {
  return {
    address,
    token,
    ethInAll: ethIn,
    tokensBoughtAll: bought,
    ethOutAll: ethOut,
    tokensSoldAll: sold,
    ethInCurve: ethIn,
    tokensBoughtCurve: bought,
    ethOutCurve: ethOut,
    tokensSoldCurve: sold,
    hasV3: false,
  };
}

describe("realizedForLeg", () => {
  it("full round-trip: buy 100 tokens for 1 ETH, sell all for 3 ETH → +2 ETH", () => {
    expect(realizedForLeg(1n * ETH, 100n, 3n * ETH, 100n)).toBe(2n * ETH);
  });

  it("partial sell: buy 100 for 2 ETH, sell 50 for 2 ETH → proceeds 2 − cost 1 = +1 ETH", () => {
    expect(realizedForLeg(2n * ETH, 100n, 2n * ETH, 50n)).toBe(1n * ETH);
  });

  it("loss leg: buy 100 for 4 ETH, sell all for 1 ETH → −3 ETH", () => {
    expect(realizedForLeg(4n * ETH, 100n, 1n * ETH, 100n)).toBe(-3n * ETH);
  });

  it("no basis (never bought) → 0 even with proceeds (no phantom gain)", () => {
    expect(realizedForLeg(0n, 0n, 5n * ETH, 100n)).toBe(0n);
  });

  it("open position (bought, not sold) → 0 realized", () => {
    expect(realizedForLeg(1n * ETH, 100n, 0n, 0n)).toBe(0n);
  });

  it("sold more than bought → only the matched (bought) fraction realizes", () => {
    // bought 100 for 1 ETH; sold 200 for 4 ETH. matched=100.
    // cost = 1·100/100 = 1; proceeds = 4·100/200 = 2 → +1 ETH.
    expect(realizedForLeg(1n * ETH, 100n, 4n * ETH, 200n)).toBe(1n * ETH);
  });
});

describe("rollUpAddressPnl — exact (curve-only)", () => {
  it("curve-only address → low == high, confidence 'exact'", () => {
    const A = addr(1);
    const input: PnlInput = {
      ...emptyInput(),
      legs: [curveLeg(A, addr(100), 1n * ETH, 100n, 3n * ETH, 100n)],
      activity: [{ address: A, tradeCount: 2, firstTradeAt: 1000, lastTradeAt: 1200 }],
      seen: [{ address: A, firstSeenAt: 990, lastSeenAt: 1200 }],
      created: [],
    };
    const [row] = rollUpAddressPnl(input);
    expect(row?.address).toBe(A);
    expect(row?.pnl_confidence).toBe("exact");
    expect(row?.realized_pnl_low).toBe((2n * ETH).toString());
    expect(row?.realized_pnl_high).toBe((2n * ETH).toString());
    expect(row?.first_seen_at).toBe(990);
    expect(row?.last_active_at).toBe(1200);
    expect(row?.trade_count).toBe(2);
    expect(row?.total_eth_in).toBe((1n * ETH).toString());
    expect(row?.total_eth_out).toBe((3n * ETH).toString());
  });

  it("aggregates realized + eth in/out across multiple tokens", () => {
    const A = addr(1);
    const input: PnlInput = {
      ...emptyInput(),
      legs: [
        curveLeg(A, addr(100), 1n * ETH, 100n, 3n * ETH, 100n), // +2
        curveLeg(A, addr(101), 2n * ETH, 100n, 1n * ETH, 100n), // −1
      ],
      seen: [{ address: A, firstSeenAt: 500, lastSeenAt: 900 }],
    };
    const [row] = rollUpAddressPnl(input);
    expect(row?.realized_pnl_low).toBe((1n * ETH).toString()); // +2 − 1
    expect(row?.realized_pnl_high).toBe((1n * ETH).toString());
    expect(row?.total_eth_in).toBe((3n * ETH).toString());
    expect(row?.total_eth_out).toBe((4n * ETH).toString());
  });
});

describe("rollUpAddressPnl — estimated (V3 legs) → range brackets curve-only vs full", () => {
  it("a V3 leg widens the band and flips confidence to 'estimated'", () => {
    const A = addr(2);
    // Curve leg: +2 ETH realized. V3 leg (best-effort): buy 100 for 1 ETH, sell
    // all for 5 ETH → +4 realized when trusted, 0 when discarded.
    const v3Leg: PnlLegRow = {
      address: A,
      token: addr(200),
      ethInAll: 1n * ETH,
      tokensBoughtAll: 100n,
      ethOutAll: 5n * ETH,
      tokensSoldAll: 100n,
      ethInCurve: 0n,
      tokensBoughtCurve: 0n,
      ethOutCurve: 0n,
      tokensSoldCurve: 0n,
      hasV3: true,
    };
    const input: PnlInput = {
      ...emptyInput(),
      legs: [curveLeg(A, addr(100), 1n * ETH, 100n, 3n * ETH, 100n), v3Leg],
      seen: [{ address: A, firstSeenAt: 10, lastSeenAt: 20 }],
    };
    const [row] = rollUpAddressPnl(input);
    expect(row?.pnl_confidence).toBe("estimated");
    // curve-only realized = +2 (V3 discarded); full = +2 + 4 = +6 (V3 trusted).
    expect(row?.realized_pnl_low).toBe((2n * ETH).toString());
    expect(row?.realized_pnl_high).toBe((6n * ETH).toString());
  });
});

describe("rollUpAddressPnl — no cost basis / identities", () => {
  it("pure transfer-in recipient (no buys) → confidence null, range 0", () => {
    const A = addr(3);
    const input: PnlInput = {
      ...emptyInput(),
      seen: [{ address: A, firstSeenAt: 100, lastSeenAt: 100 }],
    };
    const [row] = rollUpAddressPnl(input);
    expect(row?.address).toBe(A);
    expect(row?.pnl_confidence).toBeNull();
    expect(row?.realized_pnl_low).toBe("0");
    expect(row?.realized_pnl_high).toBe("0");
    expect(row?.trade_count).toBe(0);
  });

  it("pure creator with no trades still gets a row with tokens_created", () => {
    const A = addr(4);
    const input: PnlInput = {
      ...emptyInput(),
      seen: [{ address: A, firstSeenAt: 7, lastSeenAt: 7 }],
      created: [{ address: A, tokensCreated: 3 }],
    };
    const [row] = rollUpAddressPnl(input);
    expect(row?.tokens_created).toBe(3);
    expect(row?.pnl_confidence).toBeNull();
  });

  it("never emits a row for the zero address (mint source / burn sink)", () => {
    const input: PnlInput = {
      ...emptyInput(),
      legs: [curveLeg(ZERO, addr(100), 1n * ETH, 100n, 3n * ETH, 100n)],
      seen: [{ address: ZERO, firstSeenAt: 1, lastSeenAt: 2 }],
    };
    expect(rollUpAddressPnl(input)).toHaveLength(0);
  });

  it("first_seen falls back to trade activity when no transfer-seen row exists", () => {
    const A = addr(5);
    const input: PnlInput = {
      ...emptyInput(),
      legs: [curveLeg(A, addr(100), 1n * ETH, 100n, 3n * ETH, 100n)],
      activity: [{ address: A, tradeCount: 2, firstTradeAt: 4242, lastTradeAt: 4300 }],
    };
    const [row] = rollUpAddressPnl(input);
    expect(row?.first_seen_at).toBe(4242);
    expect(row?.last_active_at).toBe(4300);
  });
});
