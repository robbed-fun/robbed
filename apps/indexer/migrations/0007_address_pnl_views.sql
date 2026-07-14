-- 0007 — [offchain] address_pnl SQL views (portfolio roll-up feed). CREATE OR
-- REPLACE VIEWs over the Ponder-managed `trades` + `transfers` + `tokens` tables
-- that gather the raw aggregates the PURE `rollUpAddressPnl` (src/pnl/compute.ts)
-- consumes. The realized-PnL math + range/confidence logic lives in TS (testable,
-- no literals in SQL); these views only shape the data with FILTERed aggregates.
-- ADVISORY / read-only — never gate chain state. Rebuildable from raw
-- events. Applied in the Ponder schema AFTER `ponder start` builds those
-- tables (scripts/migrate.ts, same rule as 0003 GIN indexes / 0005 flow views).
-- All idempotent.

-- Per-(address, token) trade legs, split by venue. Curve legs are EXACT; V3 legs
-- are best-effort (recipient is often a router — OI-5), which is why
-- realized PnL is a range and `has_v3` drives 'estimated' confidence. Cost basis
-- IN = GROSS eth (fee included); proceeds OUT = NET eth (eth_amount − fee) —
-- byte-identical to the rebuild ledger's applyCostBasis* semantics (rebuild.ts).
CREATE OR REPLACE VIEW pnl_trade_legs AS
SELECT tr.trader        AS address,
       tr.token_address AS token,
       COALESCE(SUM(tr.eth_amount)              FILTER (WHERE tr.is_buy), 0)      AS eth_in_all,
       COALESCE(SUM(tr.token_amount)            FILTER (WHERE tr.is_buy), 0)      AS tokens_bought_all,
       COALESCE(SUM(tr.eth_amount - tr.fee_eth) FILTER (WHERE NOT tr.is_buy), 0)  AS eth_out_all,
       COALESCE(SUM(tr.token_amount)            FILTER (WHERE NOT tr.is_buy), 0)  AS tokens_sold_all,
       COALESCE(SUM(tr.eth_amount)              FILTER (WHERE tr.is_buy AND tr.venue = 'curve'), 0)      AS eth_in_curve,
       COALESCE(SUM(tr.token_amount)            FILTER (WHERE tr.is_buy AND tr.venue = 'curve'), 0)      AS tokens_bought_curve,
       COALESCE(SUM(tr.eth_amount - tr.fee_eth) FILTER (WHERE NOT tr.is_buy AND tr.venue = 'curve'), 0)  AS eth_out_curve,
       COALESCE(SUM(tr.token_amount)            FILTER (WHERE NOT tr.is_buy AND tr.venue = 'curve'), 0)  AS tokens_sold_curve,
       bool_or(tr.venue = 'v3') AS has_v3
FROM trades tr
GROUP BY tr.trader, tr.token_address;

-- Per-address curve+v3 trade activity (count + first/last trade ts).
CREATE OR REPLACE VIEW pnl_address_activity AS
SELECT tr.trader              AS address,
       COUNT(*)               AS trade_count,
       MIN(tr.block_timestamp) AS first_trade_at,
       MAX(tr.block_timestamp) AS last_trade_at
FROM trades tr
GROUP BY tr.trader;

-- Per-address first/last Transfer touch (both directions; the zero address — mint
-- source / burn sink — is never recorded as an address). Transfers are the sole
-- balance truth, so this is the authoritative first-seen anchor.
CREATE OR REPLACE VIEW pnl_address_seen AS
SELECT address,
       MIN(ts) AS first_seen_at,
       MAX(ts) AS last_seen_at
FROM (
  SELECT from_address AS address, block_timestamp AS ts
    FROM transfers WHERE from_address <> '0x0000000000000000000000000000000000000000'
  UNION ALL
  SELECT to_address AS address, block_timestamp AS ts
    FROM transfers WHERE to_address <> '0x0000000000000000000000000000000000000000'
) u
GROUP BY address;

-- Per-address created-token count (CREATED tab count; creator tracked day 1).
CREATE OR REPLACE VIEW pnl_tokens_created AS
SELECT creator AS address, COUNT(*) AS tokens_created
FROM tokens
GROUP BY creator;
