-- 0005 — [offchain] §8.5 bot/farm SQL views (M2-13). CREATE OR REPLACE VIEWs
-- over the Ponder-managed `trades` + `transfers` tables that gather the raw
-- aggregates the PURE `runFlowAnalysis` (src/flags/heuristics.ts) consumes. The
-- threshold logic lives in TS (config, not literals); these views only shape the
-- data with window functions. ADVISORY / labeling only — never gate chain state
-- (§8.4/§8.5). Rebuildable from raw events (§4.4).
--
-- Views are created in the CURRENT search_path (the Ponder schema, since they
-- reference the Ponder tables), applied AFTER `ponder start` builds those tables
-- (scripts/migrate.ts, same rule as the 0003 GIN indexes). All idempotent.
--
-- NOTE: the WETH pool-exit view (heuristic 5) reads v3 `trades` (venue='v3');
-- pool identity is `trades.token_address` (one graduated pool per token), so
-- "≥3 pools in one block" = ≥3 distinct token_address sells crediting one trader.

-- Heuristic 1 data — first inbound transfer per recipient address (the funding
-- event). `DISTINCT ON` + ORDER BY picks the earliest inbound per address; the
-- zero address (mint source) is never a funder we cluster on.
CREATE OR REPLACE VIEW flow_first_inbound AS
SELECT DISTINCT ON (t.to_address)
       t.to_address    AS address,
       t.from_address  AS funder,
       t.value         AS value_wei,
       t.block_timestamp AS funded_at_sec
FROM transfers t
WHERE t.from_address <> '0x0000000000000000000000000000000000000000'
ORDER BY t.to_address, t.block_number, t.log_index;

-- Heuristic 2 data — first buy per (token, trader) with the token's creation ts.
CREATE OR REPLACE VIEW flow_first_buy AS
SELECT fb.token_address AS token,
       fb.trader        AS trader,
       fb.first_buy_at_sec,
       tk.created_at     AS token_created_at_sec
FROM (
  SELECT DISTINCT ON (tr.token_address, tr.trader)
         tr.token_address,
         tr.trader,
         tr.block_timestamp AS first_buy_at_sec
  FROM trades tr
  WHERE tr.is_buy = true
  ORDER BY tr.token_address, tr.trader, tr.block_number, tr.log_index
) fb
JOIN tokens tk ON tk.address = fb.token_address;

-- Heuristic 3 data — contract-mediated execution candidates: a trade whose
-- `trader` (executor) differs from the token recipient in the same tx. The
-- own-contract whitelist is applied in TS (never flagged). One representative
-- (executor, recipient) per (token, address).
CREATE OR REPLACE VIEW flow_programmatic AS
SELECT DISTINCT ON (tr.token_address, tr.trader)
       tr.token_address AS token,
       tr.trader        AS address,
       tr.trader        AS executor,
       xf.to_address    AS recipient
FROM trades tr
JOIN transfers xf
  ON xf.tx_hash = tr.tx_hash
 AND xf.token_address = tr.token_address
 AND xf.to_address <> '0x0000000000000000000000000000000000000000'
ORDER BY tr.token_address, tr.trader, tr.block_number, tr.log_index;

-- Heuristic 4 data — per (token, address) curve buy/sell/fee totals (wash-loop +
-- organic-volume). Only curve legs count toward organic volume (§8.5.2).
CREATE OR REPLACE VIEW flow_trade_agg AS
SELECT tr.token_address AS token,
       tr.trader        AS address,
       COALESCE(SUM(tr.eth_amount) FILTER (WHERE tr.is_buy), 0)  AS buy_eth_wei,
       COALESCE(SUM(tr.eth_amount) FILTER (WHERE NOT tr.is_buy), 0) AS sell_eth_wei,
       COALESCE(SUM(tr.fee_eth), 0) AS fee_wei
FROM trades tr
WHERE tr.venue = 'curve'
GROUP BY tr.token_address, tr.trader;

-- Heuristic 5 data — same-second multi-pool WETH exits: for each (recipient,
-- block) the number of DISTINCT graduated pools (token_address) that credited a
-- v3 sell to the recipient. Grouped max per address is taken in TS.
CREATE OR REPLACE VIEW flow_multipool_exit AS
SELECT tr.trader AS address,
       tr.block_number AS block,
       COUNT(DISTINCT tr.token_address) AS pool_count
FROM trades tr
WHERE tr.venue = 'v3' AND tr.is_buy = false
GROUP BY tr.trader, tr.block_number
HAVING COUNT(DISTINCT tr.token_address) >= 2;

-- Cluster-share data — per (token, address) trailing-24h curve volume, measured
-- against each token's most-recent trade (matches the §4.4 volume_eth_24h anchor:
-- window is relative to the token's latest activity, not wall-clock now, so it is
-- deterministic and rebuildable). Feeds the gate-7 funder-cluster vol share.
CREATE OR REPLACE VIEW flow_cluster_vol_24h AS
WITH token_head AS (
  SELECT token_address, MAX(block_timestamp) AS head_ts
  FROM trades WHERE venue = 'curve' GROUP BY token_address
)
SELECT tr.token_address AS token,
       tr.trader        AS address,
       COALESCE(SUM(tr.eth_amount), 0) AS vol_24h_wei
FROM trades tr
JOIN token_head th ON th.token_address = tr.token_address
WHERE tr.venue = 'curve'
  AND tr.block_timestamp >= th.head_ts - 86400
GROUP BY tr.token_address, tr.trader;

-- Holder data — current positive holders per token (organic-holder %). The zero
-- address is excluded upstream (balances never tracks it, indexer.md §3.6).
CREATE OR REPLACE VIEW flow_holders AS
SELECT token_address AS token, holder
FROM balances
WHERE balance > 0;
