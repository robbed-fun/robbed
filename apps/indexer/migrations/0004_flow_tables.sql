-- 0004 — [offchain] §8.5 bot/farm flow tables + §8.5.3 competitor snapshots
-- (v1.2). Indexer-owned derived side tables, rebuildable from trades+transfers
-- (indexer.md §8.5.2). ADVISORY / labeling only — never gate chain state or
-- listing (§8.4/§8.5). Populated by scheduled jobs (M2-13/M2-14), read by the
-- API Trust feed + gate-7 metric. No FK to Ponder tables (stable public schema).
-- Column names/types mirror @robbed/shared db-rows (AddressFlagsRow,
-- TokenFlowStatsRow, CompetitorSnapshotRow).

-- §8.5.2 address_flags — per-address bot/farm labels + funder cluster.
-- flags[] uses the shared BotFlag vocabulary ('farm','sniper','programmatic',
-- 'wash','arb_exit') — validated app-side, stored as text[].
CREATE TABLE IF NOT EXISTS address_flags (
  address     text PRIMARY KEY,
  flags       text[] NOT NULL DEFAULT '{}',
  cluster_id  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS address_flags_cluster_idx ON address_flags (cluster_id);

-- §8.5.2 token_flow_stats — per-token organic estimates (RANGES; §5.2 forbids
-- false precision). Feeds the Trust panel + the gate-7 cluster-alert metric.
CREATE TABLE IF NOT EXISTS token_flow_stats (
  token_address              text PRIMARY KEY,
  organic_holder_pct_low     double precision NOT NULL,
  organic_holder_pct_high    double precision NOT NULL,
  organic_volume_pct         double precision NOT NULL,
  flagged_cluster_vol_pct_24h double precision NOT NULL,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- §8.5.3 competitor_snapshots — weekly, SOURCE+TIMESTAMPED hood.fun traction;
-- never a hardcoded metric (§2). visible_volume_eth is wei-denominated decimal.
CREATE TABLE IF NOT EXISTS competitor_snapshots (
  source              text NOT NULL,
  captured_at         timestamptz NOT NULL,
  tokens_per_day      integer NOT NULL,
  graduations         integer NOT NULL,
  visible_volume_eth  numeric(78,0) NOT NULL,
  PRIMARY KEY (source, captured_at)
);
