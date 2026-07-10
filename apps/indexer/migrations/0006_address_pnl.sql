-- 0006 — [offchain] address_pnl: per-ADDRESS portfolio roll-up (spec §5.4;
-- ROBBED_ redesign page 4 `/portfolio`). Indexer-owned DERIVED side table,
-- rebuildable from `trades`+`transfers`+`tokens` (indexer.md §4.4). ADVISORY /
-- read-only — never gates chain state or listing (§8.4). Lives in stable `public`
-- (like the §8.5 flow side tables, 0004) so it survives Ponder schema redeploys
-- and never FKs Ponder tables. Column names/types mirror @robbed/shared db-rows
-- `AddressPnlRow`.
--
-- Aggregate across ALL of an address's tokens; per-(token, holder) detail stays
-- in `balances` (this is its address-level roll-up, NOT a duplicate). Cost-basis
-- fields are best-effort: the V3-leg basis is approximate (spec §12.16 OI-5), so
-- REALIZED PnL is a RANGE (`_low`/`_high`; §5.2 forbids false precision), signed
-- wei decimal strings. UNREALIZED / all-time PnL is NOT materialized here — it is
-- computed at request time (live price × balance − remaining basis), since price
-- is live (api.md §3, portfolio). `pnl_confidence` is null when NO cost basis
-- exists at all (pure transfer-in holdings). Every input derives from Transfer /
-- Trade truth (X-4/X-5), never external.
CREATE TABLE IF NOT EXISTS address_pnl (
  address            text PRIMARY KEY,
  first_seen_at      bigint NOT NULL,            -- earliest Transfer touching the address, unix seconds
  last_active_at     bigint NOT NULL,
  trade_count        bigint NOT NULL DEFAULT 0,  -- curve+v3 trades BY the address
  tokens_created     bigint NOT NULL DEFAULT 0,  -- tokens whose creator == address (CREATED tab count)
  total_eth_in       numeric(78,0) NOT NULL DEFAULT 0,  -- aggregate ETH spent buying across all tokens, wei
  total_eth_out      numeric(78,0) NOT NULL DEFAULT 0,  -- aggregate ETH received selling, wei
  realized_pnl_low   numeric(78,0) NOT NULL DEFAULT 0,  -- realized (closed legs) best-effort range, signed wei
  realized_pnl_high  numeric(78,0) NOT NULL DEFAULT 0,
  -- null when no cost basis exists at all; 'estimated' when any V3-leg basis is involved.
  pnl_confidence     text CHECK (pnl_confidence IN ('exact','estimated')),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
