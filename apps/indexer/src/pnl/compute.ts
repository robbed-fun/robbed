/**
 * address_pnl roll-up — PURE compute (; api.md portfolio;
 * db-rows.ts `AddressPnlRow`). DB-free and fully unit-testable: the single source
 * of the realized-PnL range math. `src/pnl/store.ts` runs the 0007 views to
 * gather the aggregates below, calls `rollUpAddressPnl`, and TRUNCATE+re-inserts
 * `address_pnl`. Rebuildable from `trades`+`transfers`.
 *
 * ADVISORY / read-only — nothing here gates a trade, listing, or chain state
 *. Outputs are RANGES (forbids false precision).
 *
 * ── Realized-PnL model (decide-it-yourself; basis recorded) ──────────────────
 * Average-cost realized PnL per (address, token) over the CLOSED (matched) leg:
 *   soldMatched  = min(tokensSold, tokensBought)            // only bought tokens carry basis
 *   costOfSold   = ethIn  · soldMatched / tokensBought      // avg cost on the matched qty
 *   proceeds     = ethOut · soldMatched / tokensSold        // proceeds for the matched fraction
 *   realized     = proceeds − costOfSold
 * Only the matched fraction counts, so tokens acquired purely by transfer-in and
 * then sold (no recorded basis) never fabricate a phantom gain. All bigint/wei.
 *
 * ── The RANGE (why realized is `low`..`high`, not a point) ───────────────────
 * V3 legs' cost basis is best-effort — the `Swap.recipient` is often a router,
 * not the EOA (OI-5) — so the ETH-in/out attributed to V3 buys/sells
 * can be wrong. Rather than invent a numeric error width (itself false precision),
 * the band brackets the two extreme interpretations of the V3 legs:
 *   • `curveRealized` = realized counting CURVE legs only (V3 attribution DISCARDED)
 *   • `fullRealized`  = realized counting ALL legs        (V3 attribution TRUSTED)
 *   low = min(curveRealized, fullRealized), high = max(...)
 * Curve-only addresses have no V3 leg ⇒ curve == full ⇒ low == high, `exact`.
 * Any V3 leg ⇒ `estimated`. No cost basis anywhere ⇒ `pnl_confidence = null`
 * (and low == high == 0), so the API surfaces `pnlAllTime = null`.
 */

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Per-(address, token) trade legs split by venue (view `pnl_trade_legs`). */
export interface PnlLegRow {
  address: string;
  token: string;
  ethInAll: bigint;
  tokensBoughtAll: bigint;
  ethOutAll: bigint;
  tokensSoldAll: bigint;
  ethInCurve: bigint;
  tokensBoughtCurve: bigint;
  ethOutCurve: bigint;
  tokensSoldCurve: bigint;
  hasV3: boolean;
}

/** Per-address trade activity (view `pnl_address_activity`). */
export interface PnlActivityRow {
  address: string;
  tradeCount: number;
  firstTradeAt: number;
  lastTradeAt: number;
}

/** Per-address first/last Transfer touch (view `pnl_address_seen`). */
export interface PnlSeenRow {
  address: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

/** Per-address created-token count (view `pnl_tokens_created`). */
export interface PnlCreatedRow {
  address: string;
  tokensCreated: number;
}

export interface PnlInput {
  legs: PnlLegRow[];
  activity: PnlActivityRow[];
  seen: PnlSeenRow[];
  created: PnlCreatedRow[];
}

/** Row-shaped result (matches db-rows.ts `AddressPnlRow`, minus `updated_at`). */
export interface AddressPnlComputed {
  address: string;
  first_seen_at: number;
  last_active_at: number;
  trade_count: number;
  tokens_created: number;
  total_eth_in: string;
  total_eth_out: string;
  realized_pnl_low: string;
  realized_pnl_high: string;
  pnl_confidence: "exact" | "estimated" | null;
}

/** Average-cost realized PnL over the matched (closed) leg, wei. */
export function realizedForLeg(
  ethIn: bigint,
  tokensBought: bigint,
  ethOut: bigint,
  tokensSold: bigint,
): bigint {
  if (tokensBought <= 0n || tokensSold <= 0n) return 0n;
  const soldMatched = tokensSold < tokensBought ? tokensSold : tokensBought;
  const costOfSold = (ethIn * soldMatched) / tokensBought;
  const proceeds = (ethOut * soldMatched) / tokensSold;
  return proceeds - costOfSold;
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

/**
 * Roll every per-token leg up to one `address_pnl` row per address. The zero
 * address is never emitted (mint source / burn sink is not a portfolio).
 */
export function rollUpAddressPnl(input: PnlInput): AddressPnlComputed[] {
  const activity = new Map(input.activity.map((a) => [a.address, a]));
  const seen = new Map(input.seen.map((s) => [s.address, s]));
  const created = new Map(input.created.map((c) => [c.address, c]));

  // Accumulate per address across all its token legs.
  interface Acc {
    ethIn: bigint;
    ethOut: bigint;
    fullRealized: bigint;
    curveRealized: bigint;
    hasV3: boolean;
    hasBasis: boolean;
  }
  const accs = new Map<string, Acc>();
  const get = (addr: string): Acc => {
    let a = accs.get(addr);
    if (!a) {
      a = {
        ethIn: 0n,
        ethOut: 0n,
        fullRealized: 0n,
        curveRealized: 0n,
        hasV3: false,
        hasBasis: false,
      };
      accs.set(addr, a);
    }
    return a;
  };

  for (const leg of input.legs) {
    if (leg.address === ZERO_ADDRESS) continue;
    const a = get(leg.address);
    a.ethIn += leg.ethInAll;
    a.ethOut += leg.ethOutAll;
    a.fullRealized += realizedForLeg(
      leg.ethInAll,
      leg.tokensBoughtAll,
      leg.ethOutAll,
      leg.tokensSoldAll,
    );
    a.curveRealized += realizedForLeg(
      leg.ethInCurve,
      leg.tokensBoughtCurve,
      leg.ethOutCurve,
      leg.tokensSoldCurve,
    );
    if (leg.hasV3) a.hasV3 = true;
    if (leg.tokensBoughtAll > 0n) a.hasBasis = true;
  }

  // Every address that appears in ANY view gets a row (a pure creator or a
  // transfer-only recipient has no legs but still has a portfolio identity).
  const addresses = new Set<string>([
    ...accs.keys(),
    ...input.activity.map((a) => a.address),
    ...input.seen.map((s) => s.address),
    ...input.created.map((c) => c.address),
  ]);
  addresses.delete(ZERO_ADDRESS);

  const out: AddressPnlComputed[] = [];
  for (const address of addresses) {
    const a = accs.get(address);
    const act = activity.get(address);
    const sn = seen.get(address);
    const cr = created.get(address);

    // first_seen: earliest of Transfer touch and trade activity (transfers are
    // the sole balance truth so they normally dominate; the trade fallback keeps
    // the field defined if a legs/seen view ever diverges).
    const seenFirst = sn?.firstSeenAt;
    const tradeFirst = act?.firstTradeAt;
    const firstSeen = pickMin(seenFirst, tradeFirst) ?? 0;
    const lastActive = pickMax(sn?.lastSeenAt, act?.lastTradeAt) ?? firstSeen;

    let low = 0n;
    let high = 0n;
    let confidence: "exact" | "estimated" | null = null;
    if (a && a.hasBasis) {
      low = min(a.curveRealized, a.fullRealized);
      high = max(a.curveRealized, a.fullRealized);
      confidence = a.hasV3 ? "estimated" : "exact";
    }

    out.push({
      address,
      first_seen_at: firstSeen,
      last_active_at: lastActive,
      trade_count: act?.tradeCount ?? 0,
      tokens_created: cr?.tokensCreated ?? 0,
      total_eth_in: (a?.ethIn ?? 0n).toString(),
      total_eth_out: (a?.ethOut ?? 0n).toString(),
      realized_pnl_low: low.toString(),
      realized_pnl_high: high.toString(),
      pnl_confidence: confidence,
    });
  }
  return out;
}

function pickMin(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}
function pickMax(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}
