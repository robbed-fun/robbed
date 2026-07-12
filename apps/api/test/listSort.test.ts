/**
 * §12.59 server-side sort primitives (lib/listSort.ts): the allowlist→column map
 * IS the ORDER BY security boundary, the keyset SQL fragments compose sort with
 * pagination, and the cursor-key extractors + label ranking are single-sourced so
 * the real SQL (db.bun.ts) and the test fake (helpers.ts) cannot drift.
 */
import { describe, expect, it } from "bun:test";
import { HOLDER_SORT_FIELDS, TRADE_SORT_FIELDS, type TradeRowDb } from "@robbed/shared";
import {
  HOLDER_SORT_COLUMNS,
  HOLDER_TIEBREAK,
  TRADE_SORT_COLUMNS,
  TRADE_TIEBREAK,
  holderLabelRank,
  holderSortKey,
  keysetOp,
  keysetPredicate,
  orderByClause,
  tradeSortKey,
} from "../src/lib/listSort";

const ADDR = "0x" + "ab".repeat(20);

const trade: TradeRowDb = {
  id: `${"0x" + "12".repeat(32)}-3`,
  token_address: ADDR,
  trader: "0x" + "cd".repeat(20),
  venue: "curve",
  is_buy: false,
  eth_amount: "5000000000000000000",
  token_amount: "10",
  fee_eth: "50000000000000000",
  price_eth: 1.25e-8,
  block_number: 200,
  block_timestamp: 1_767_950_123,
  tx_hash: "0x" + "12".repeat(32),
  log_index: 3,
  confirmation_state: "soft_confirmed",
};

describe("allowlist → fixed column map (the ORDER BY security boundary)", () => {
  it("maps every TRADE_SORT_FIELDS member to a hardcoded column (no gaps)", () => {
    // Every shared allowlist member has a fixed target — so the enum, validated
    // by the route, fully determines the ORDER BY. No member → arbitrary column.
    for (const f of TRADE_SORT_FIELDS) expect(TRADE_SORT_COLUMNS[f]).toBeDefined();
    expect(Object.keys(TRADE_SORT_COLUMNS).sort()).toEqual([...TRADE_SORT_FIELDS].sort());
    expect(TRADE_SORT_COLUMNS.age.expr).toBe("block_timestamp");
    expect(TRADE_SORT_COLUMNS.side.expr).toBe("is_buy");
    expect(TRADE_SORT_COLUMNS.trader.expr).toBe("trader");
    expect(TRADE_SORT_COLUMNS.amount.expr).toBe("eth_amount::numeric");
    expect(TRADE_SORT_COLUMNS.price.expr).toBe("price_eth");
  });

  it("maps every HOLDER_SORT_FIELDS member; rank/amount/percent share balance::numeric", () => {
    for (const f of HOLDER_SORT_FIELDS) expect(HOLDER_SORT_COLUMNS[f]).toBeDefined();
    expect(Object.keys(HOLDER_SORT_COLUMNS).sort()).toEqual([...HOLDER_SORT_FIELDS].sort());
    // one physical key for the three balance-backed columns (§12.59 note)
    expect(HOLDER_SORT_COLUMNS.rank.expr).toBe("balance::numeric");
    expect(HOLDER_SORT_COLUMNS.amount.expr).toBe("balance::numeric");
    expect(HOLDER_SORT_COLUMNS.percent.expr).toBe("balance::numeric");
    expect(HOLDER_SORT_COLUMNS.address.expr).toBe("holder");
    expect(HOLDER_SORT_COLUMNS.label.expr).toBe("label_rank");
  });

  it("column expressions are static identifiers — never carry caller-derived text", () => {
    for (const c of [...Object.values(TRADE_SORT_COLUMNS), ...Object.values(HOLDER_SORT_COLUMNS)]) {
      expect(c.expr).toMatch(/^[a-z_]+(::numeric)?$/); // fixed ident, optional ::numeric cast
    }
  });
});

describe("keyset SQL composition (sort ⊕ pagination)", () => {
  it("desc walks down (<), asc walks up (>)", () => {
    expect(keysetOp("desc")).toBe("<");
    expect(keysetOp("asc")).toBe(">");
  });

  it("orderByClause applies ONE direction across (col, tiebreak)", () => {
    expect(orderByClause("block_timestamp", TRADE_TIEBREAK, "desc")).toBe(
      "block_timestamp DESC, id DESC",
    );
    expect(orderByClause("holder", HOLDER_TIEBREAK, "asc")).toBe("holder ASC, holder ASC");
  });

  it("keysetPredicate is a row-value compare with a cast $k and plain $i", () => {
    // desc trades-by-amount page-2 predicate: params $6=k, $7=i
    expect(keysetPredicate(TRADE_SORT_COLUMNS.amount, TRADE_TIEBREAK, "desc", 6, 7)).toBe(
      "(eth_amount::numeric, id) < ($6::numeric, $7)",
    );
    // asc holders-by-label predicate
    expect(keysetPredicate(HOLDER_SORT_COLUMNS.label, HOLDER_TIEBREAK, "asc", 2, 3)).toBe(
      "(label_rank, holder) > ($2::int, $3)",
    );
    // boolean side sort casts $k::boolean
    expect(keysetPredicate(TRADE_SORT_COLUMNS.side, TRADE_TIEBREAK, "desc", 4, 5)).toBe(
      "(is_buy, id) < ($4::boolean, $5)",
    );
  });
});

describe("cursor-key extractors (k transport form matches the SQL column)", () => {
  it("tradeSortKey mirrors each column's selected value", () => {
    expect(tradeSortKey("age", trade)).toBe("1767950123");
    expect(tradeSortKey("side", trade)).toBe("false"); // ::boolean form
    expect(tradeSortKey("trader", trade)).toBe(trade.trader);
    expect(tradeSortKey("amount", trade)).toBe("5000000000000000000");
    expect(tradeSortKey("price", trade)).toBe(String(1.25e-8));
  });

  it("holderSortKey: balance for rank/amount/percent, holder for address, label_rank for label", () => {
    const row = { holder: ADDR, balance: "42", rank: 7, label_rank: 3 };
    expect(holderSortKey("rank", row)).toBe("42");
    expect(holderSortKey("amount", row)).toBe("42");
    expect(holderSortKey("percent", row)).toBe("42");
    expect(holderSortKey("address", row)).toBe(ADDR);
    expect(holderSortKey("label", row)).toBe("3");
  });
});

describe("holderLabelRank — deterministic role/flag ordering (§12.58)", () => {
  const special = {
    creator: "0x" + "c1".repeat(20),
    curve: "0x" + "c2".repeat(20),
    pool: "0x" + "c3".repeat(20),
    vaults: new Set(["0x" + "c4".repeat(20)]),
  };
  it("ranks curve<creator<pool<vault<flagged<unlabeled and is case-insensitive", () => {
    expect(holderLabelRank({ holder: special.curve.toUpperCase() }, special)).toBe(0);
    expect(holderLabelRank({ holder: special.creator }, special)).toBe(1);
    expect(holderLabelRank({ holder: special.pool! }, special)).toBe(2);
    expect(holderLabelRank({ holder: "0x" + "c4".repeat(20) }, special)).toBe(3);
    expect(holderLabelRank({ holder: "0x" + "ee".repeat(20), botFlags: ["sniper"] }, special)).toBe(4);
    expect(holderLabelRank({ holder: "0x" + "ee".repeat(20) }, special)).toBe(5);
    expect(holderLabelRank({ holder: "0x" + "ee".repeat(20), botFlags: [] }, special)).toBe(5);
  });
});
