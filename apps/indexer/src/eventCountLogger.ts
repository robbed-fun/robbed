import type { Pool } from "pg";
import {
  bondingCurveCreatorEventsAbi,
  bondingCurveEventsAbi,
  creatorVaultEventsAbi,
  creatorVaultTokenEventsAbi,
  curveFactoryEventsAbi,
  launchTokenEventsAbi,
  lpFeeVaultSplitEventsAbi,
  v3MigratorEventsAbi,
  v3PoolEventsAbi,
  v3PositionManagerEventsAbi,
} from "@robbed/shared/abi";
import { toEventSelector, type AbiEvent } from "viem";

export const DEFAULT_EVENT_COUNTS_LOG_MS = 30_000;
export const DEFAULT_PONDER_METRICS_URL = "http://127.0.0.1:42069/metrics";
export const DEFAULT_PONDER_RAW_LOG_BLOCKS = 6;
export const DEFAULT_PONDER_RAW_LOG_MAX_ROWS = 120;
export const MAX_PONDER_RAW_LOG_BLOCKS = 25;
export const MAX_PONDER_RAW_LOG_ROWS = 500;

interface EventCountSource {
  event: string;
  table: string;
  where?: string;
}

export const EVENT_COUNT_SOURCES = [
  { event: "CurveFactory:TokenCreated", table: "tokens" },
  { event: "BondingCurve:Trade", table: "trades", where: "venue = 'curve'" },
  { event: "LaunchToken:Transfer", table: "transfers" },
  { event: "V3Migrator:Graduated", table: "graduations" },
  { event: "UniswapV3Pool:Swap", table: "trades", where: "venue = 'v3'" },
  { event: "V3PositionManager:Collect", table: "fee_collections" },
] as const satisfies readonly EventCountSource[];

const EVENT_LOG_ORDER = [
  "CurveFactory:setup",
  "CurveFactory:TokenCreated",
  "BondingCurve:Trade",
  "BondingCurve:CreatorFeesSwept",
  "LaunchToken:Transfer",
  "V3Migrator:Graduated",
  "UniswapV3Pool:Swap",
  "V3PositionManager:Collect",
  "LPFeeVault:FeesSplit",
  "CreatorVault:CreatorFeeDeposited",
  "CreatorVault:CreatorFeeClaimed",
  "CreatorVault:CreatorTokenDeposited",
  "CreatorVault:CreatorTokenClaimed",
] as const;

export interface EventCountLogRow {
  Event: string;
  Table: string;
  Count: string;
  "Last block": string;
}

export interface PonderEventCountLogRow {
  Event: string;
  Count: string;
  "Duration (ms)": string;
}

export interface PonderRawLogBlockRow {
  Block: string;
  Chain: string;
  Logs: string;
  Txs: string;
  Contracts: string;
  Events: string;
  "Unknown topics": string;
}

interface EventCountQueryRow {
  count: string | number | bigint | null;
  last_block: string | number | bigint | null;
}

interface PonderRawLogQueryRow {
  address: string | null;
  block_number: string | number | bigint | null;
  chain_id: string | number | bigint | null;
  topic0: string | null;
  transaction_hash: string | null;
  block_log_count: string | number | bigint | null;
}

interface EventCountLoggerOptions {
  intervalMs?: number | null;
  metricsUrl?: string | null;
  rawLogBlocks?: number | null;
  rawLogMaxRows?: number | null;
  chainId?: number | null;
  fetchMetrics?: (url: string) => Promise<string>;
  logger?: Pick<Console, "error" | "log"> & Partial<Pick<Console, "table">>;
  now?: () => Date;
}

export interface PonderRawLogConfig {
  blocks: number;
  maxRows: number;
  chainId: number | null;
}

const PONDER_RAW_LOG_EVENTS = [
  ["CurveFactory", curveFactoryEventsAbi],
  ["BondingCurve", bondingCurveEventsAbi],
  ["BondingCurve", bondingCurveCreatorEventsAbi],
  ["LaunchToken", launchTokenEventsAbi],
  ["V3Migrator", v3MigratorEventsAbi],
  ["UniswapV3Pool", v3PoolEventsAbi],
  ["V3PositionManager", v3PositionManagerEventsAbi],
  ["LPFeeVault", lpFeeVaultSplitEventsAbi],
  ["CreatorVault", creatorVaultEventsAbi],
  ["CreatorVault", creatorVaultTokenEventsAbi],
] as const;

const PONDER_RAW_LOG_TOPIC_LABELS = new Map(
  PONDER_RAW_LOG_EVENTS.flatMap(([contract, events]) =>
    events.map(
      (event) =>
        [toEventSelector(event as AbiEvent).toLowerCase(), `${contract}:${event.name}`] as const,
    ),
  ),
);

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function formatCount(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined) return "0";
  return String(value);
}

function formatLastBlock(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return String(value);
}

function parseLogIntervalMs(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return DEFAULT_EVENT_COUNTS_LOG_MS;
  if (raw === "off" || raw === "0") return null;

  const intervalMs = Number(raw);
  if (!Number.isInteger(intervalMs) || intervalMs < 1_000) {
    throw new Error(
      "[indexer events] INDEXER_EVENT_COUNTS_LOG_MS must be off, 0, or an integer >= 1000",
    );
  }
  return intervalMs;
}

export function loadEventCountLogIntervalMs(env: NodeJS.ProcessEnv = process.env): number | null {
  return parseLogIntervalMs(env.INDEXER_EVENT_COUNTS_LOG_MS);
}

function parseBoundedLogInt(
  raw: string | undefined,
  name: string,
  defaultValue: number,
  maxValue: number,
): number | null {
  if (raw === undefined || raw === "") return defaultValue;
  if (raw === "off" || raw === "0") return null;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maxValue) {
    throw new Error(
      `[indexer events] ${name} must be off, 0, or an integer between 1 and ${maxValue}`,
    );
  }
  return value;
}

function loadRawLogChainId(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.INDEXER_CHAIN_ID;
  if (raw === undefined || raw === "") return null;

  const chainId = Number(raw);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(
      "[indexer events] INDEXER_CHAIN_ID must be a positive integer when raw log filtering is enabled",
    );
  }
  return chainId;
}

export function loadPonderRawLogConfig(
  env: NodeJS.ProcessEnv = process.env,
): PonderRawLogConfig | null {
  const blocks = parseBoundedLogInt(
    env.INDEXER_PONDER_RAW_LOG_BLOCKS,
    "INDEXER_PONDER_RAW_LOG_BLOCKS",
    DEFAULT_PONDER_RAW_LOG_BLOCKS,
    MAX_PONDER_RAW_LOG_BLOCKS,
  );
  const maxRows = parseBoundedLogInt(
    env.INDEXER_PONDER_RAW_LOG_MAX_ROWS,
    "INDEXER_PONDER_RAW_LOG_MAX_ROWS",
    DEFAULT_PONDER_RAW_LOG_MAX_ROWS,
    MAX_PONDER_RAW_LOG_ROWS,
  );

  if (blocks === null || maxRows === null) return null;
  return { blocks, maxRows, chainId: loadRawLogChainId(env) };
}

function loadPonderMetricsUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.INDEXER_PONDER_METRICS_URL;
  if (raw === "off" || raw === "0") return null;
  return raw && raw !== "" ? raw : DEFAULT_PONDER_METRICS_URL;
}

async function readSourceCount(
  pool: Pool,
  schema: string,
  source: EventCountSource,
): Promise<EventCountLogRow> {
  const where = source.where ? ` WHERE ${source.where}` : "";
  const result = await pool.query<EventCountQueryRow>(
    `SELECT count(*)::text AS count, max(block_number)::text AS last_block FROM ${quoteIdent(schema)}.${quoteIdent(source.table)}${where}`,
  );
  const row = result.rows[0];

  return {
    Event: source.event,
    Table: source.table,
    Count: formatCount(row?.count),
    "Last block": formatLastBlock(row?.last_block),
  };
}

export async function readEventCountRows(pool: Pool, schema: string): Promise<EventCountLogRow[]> {
  const rows: EventCountLogRow[] = [];
  for (const source of EVENT_COUNT_SOURCES) {
    try {
      rows.push(await readSourceCount(pool, schema, source));
    } catch {
      rows.push({
        Event: source.event,
        Table: source.table,
        Count: "pending",
        "Last block": "-",
      });
    }
  }

  let total = 0n;
  let lastBlock: bigint | undefined;
  for (const row of rows) {
    if (!/^\d+$/.test(row.Count)) continue;
    total += BigInt(row.Count);
    if (/^\d+$/.test(row["Last block"])) {
      const block = BigInt(row["Last block"]);
      if (lastBlock === undefined || block > lastBlock) lastBlock = block;
    }
  }

  return [
    ...rows,
    {
      Event: "TOTAL",
      Table: "persisted event rows",
      Count: String(total),
      "Last block": lastBlock === undefined ? "-" : String(lastBlock),
    },
  ];
}

function parsePrometheusLabels(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const labels: Record<string, string> = {};
  for (const part of raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const match = part.match(/^([^=]+)="(.*)"$/);
    if (!match) continue;
    labels[match[1]!] = match[2]!.replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  }
  return labels;
}

function eventOrder(event: string): number {
  const index = EVENT_LOG_ORDER.indexOf(event as (typeof EVENT_LOG_ORDER)[number]);
  return index === -1 ? EVENT_LOG_ORDER.length : index;
}

function formatTopicKey(topic0: string | null | undefined): string {
  if (!topic0) return "<no topic0>";
  return topic0.toLowerCase();
}

function formatUnknownTopic(topic0: string): string {
  if (topic0 === "<no topic0>") return topic0;
  if (topic0.length <= 18) return topic0;
  return `${topic0.slice(0, 10)}...${topic0.slice(-6)}`;
}

function summarizeCounts(
  counts: Map<string, number>,
  options: { knownOnly: boolean; limit: number },
): string {
  const rows = [...counts.entries()]
    .filter(([label]) =>
      options.knownOnly
        ? PONDER_RAW_LOG_TOPIC_LABELS.has(label)
        : !PONDER_RAW_LOG_TOPIC_LABELS.has(label),
    )
    .sort(([a, aCount], [b, bCount]) => {
      if (options.knownOnly) {
        const aLabel = PONDER_RAW_LOG_TOPIC_LABELS.get(a) ?? a;
        const bLabel = PONDER_RAW_LOG_TOPIC_LABELS.get(b) ?? b;
        return eventOrder(aLabel) - eventOrder(bLabel) || aLabel.localeCompare(bLabel);
      }
      return bCount - aCount || a.localeCompare(b);
    });

  if (rows.length === 0) return "-";

  const shown = rows.slice(0, options.limit).map(([label, count]) => {
    const display = options.knownOnly
      ? PONDER_RAW_LOG_TOPIC_LABELS.get(label)!
      : formatUnknownTopic(label);
    return count === 1 ? display : `${display} x${count}`;
  });
  const hidden = rows.length - shown.length;
  if (hidden > 0) shown.push(`+${hidden} more`);
  return shown.join(", ");
}

function formatAverageDuration(sum: number, count: number): string {
  if (count === 0) return "-";
  const average = sum / count;
  return average < 0.001 ? "<0.001" : average.toFixed(3);
}

export function parsePonderIndexingMetrics(text: string): PonderEventCountLogRow[] {
  const counts = new Map<string, number>();
  const durationSums = new Map<string, number>();
  const durationCounts = new Map<string, number>();

  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const match = line.match(
      /^([a-zA-Z_:][\w:]*)(?:\{([^}]*)\})?\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i,
    );
    if (!match) continue;

    const name = match[1]!;
    const labels = parsePrometheusLabels(match[2]);
    const event = labels.event;
    if (!event) continue;

    const value = Number(match[3]);
    if (!Number.isFinite(value)) continue;

    if (name === "ponder_indexing_completed_events") {
      counts.set(event, (counts.get(event) ?? 0) + value);
    } else if (name === "ponder_indexing_function_duration_sum") {
      durationSums.set(event, (durationSums.get(event) ?? 0) + value);
    } else if (name === "ponder_indexing_function_duration_count") {
      durationCounts.set(event, (durationCounts.get(event) ?? 0) + value);
    }
  }

  return [...counts.entries()]
    .sort(([a], [b]) => eventOrder(a) - eventOrder(b) || a.localeCompare(b))
    .map(([event, count]) => ({
      Event: event,
      Count: String(count),
      "Duration (ms)": formatAverageDuration(
        durationSums.get(event) ?? 0,
        durationCounts.get(event) ?? 0,
      ),
    }));
}

async function fetchPonderMetrics(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
  if (!response.ok) {
    throw new Error(`Ponder metrics returned HTTP ${response.status}`);
  }
  return response.text();
}

async function readPonderEventCountRows(
  options: EventCountLoggerOptions,
): Promise<PonderEventCountLogRow[]> {
  const metricsUrl = options.metricsUrl === undefined ? loadPonderMetricsUrl() : options.metricsUrl;
  if (metricsUrl === null) return [];

  const metricsText = await (options.fetchMetrics ?? fetchPonderMetrics)(metricsUrl);
  return parsePonderIndexingMetrics(metricsText);
}

function resolveRawLogConfig(options: EventCountLoggerOptions): PonderRawLogConfig | null {
  if (options.rawLogBlocks === null || options.rawLogMaxRows === null) return null;

  const blocks =
    options.rawLogBlocks ??
    parseBoundedLogInt(
      process.env.INDEXER_PONDER_RAW_LOG_BLOCKS,
      "INDEXER_PONDER_RAW_LOG_BLOCKS",
      DEFAULT_PONDER_RAW_LOG_BLOCKS,
      MAX_PONDER_RAW_LOG_BLOCKS,
    );
  const maxRows =
    options.rawLogMaxRows ??
    parseBoundedLogInt(
      process.env.INDEXER_PONDER_RAW_LOG_MAX_ROWS,
      "INDEXER_PONDER_RAW_LOG_MAX_ROWS",
      DEFAULT_PONDER_RAW_LOG_MAX_ROWS,
      MAX_PONDER_RAW_LOG_ROWS,
    );

  if (blocks === null || maxRows === null) return null;
  return {
    blocks,
    maxRows,
    chainId: options.chainId === undefined ? loadRawLogChainId() : options.chainId,
  };
}

export async function readPonderRawLogBlockRows(
  pool: Pool,
  options: Pick<EventCountLoggerOptions, "rawLogBlocks" | "rawLogMaxRows" | "chainId"> = {},
): Promise<PonderRawLogBlockRow[]> {
  const config = resolveRawLogConfig(options);
  if (config === null) return [];

  const result = await pool.query<PonderRawLogQueryRow>(
    `
WITH recent_blocks AS (
  SELECT block_number, chain_id
  FROM ponder_sync.logs
  WHERE ($1::bigint IS NULL OR chain_id = $1::bigint)
  GROUP BY block_number, chain_id
  ORDER BY block_number DESC, chain_id ASC
  LIMIT $2
)
SELECT
  l.address::text AS address,
  l.block_number::text AS block_number,
  l.chain_id::text AS chain_id,
  l.topic0::text AS topic0,
  l.transaction_hash::text AS transaction_hash,
  count(*) OVER (PARTITION BY l.block_number, l.chain_id)::text AS block_log_count
FROM ponder_sync.logs l
JOIN recent_blocks b ON b.block_number = l.block_number AND b.chain_id = l.chain_id
WHERE ($1::bigint IS NULL OR l.chain_id = $1::bigint)
ORDER BY l.block_number DESC, l.transaction_index ASC, l.log_index ASC
LIMIT $3
`.trim(),
    [config.chainId, config.blocks, config.maxRows],
  );

  interface BlockSummary {
    block: string;
    chain: string;
    shownLogs: number;
    totalLogs: bigint;
    txs: Set<string>;
    contracts: Set<string>;
    topicCounts: Map<string, number>;
  }

  const blocks = new Map<string, BlockSummary>();
  for (const row of result.rows) {
    const block = formatLastBlock(row.block_number);
    const chain = formatLastBlock(row.chain_id);
    const key = `${block}:${chain}`;
    let summary = blocks.get(key);
    if (!summary) {
      summary = {
        block,
        chain,
        shownLogs: 0,
        totalLogs: BigInt(formatCount(row.block_log_count)),
        txs: new Set(),
        contracts: new Set(),
        topicCounts: new Map(),
      };
      blocks.set(key, summary);
    }

    summary.shownLogs += 1;
    const totalLogs = BigInt(formatCount(row.block_log_count));
    if (totalLogs > summary.totalLogs) summary.totalLogs = totalLogs;
    if (row.transaction_hash) summary.txs.add(row.transaction_hash.toLowerCase());
    if (row.address) summary.contracts.add(row.address.toLowerCase());

    const topicKey = formatTopicKey(row.topic0);
    summary.topicCounts.set(topicKey, (summary.topicCounts.get(topicKey) ?? 0) + 1);
  }

  return [...blocks.values()].map((summary) => ({
    Block: summary.block,
    Chain: summary.chain,
    Logs:
      BigInt(summary.shownLogs) === summary.totalLogs
        ? String(summary.totalLogs)
        : `${summary.shownLogs}/${summary.totalLogs}`,
    Txs: String(summary.txs.size),
    Contracts: String(summary.contracts.size),
    Events: summarizeCounts(summary.topicCounts, { knownOnly: true, limit: 6 }),
    "Unknown topics": summarizeCounts(summary.topicCounts, { knownOnly: false, limit: 3 }),
  }));
}

function isMissingRawLogTable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const maybe = err as { code?: unknown; message?: unknown };
  return (
    maybe.code === "42P01" ||
    (typeof maybe.message === "string" && maybe.message.includes("ponder_sync.logs"))
  );
}

async function readPonderRawLogRowsForLogging(
  pool: Pool,
  options: EventCountLoggerOptions,
  logger: Pick<Console, "error">,
): Promise<PonderRawLogBlockRow[]> {
  try {
    return await readPonderRawLogBlockRows(pool, options);
  } catch (err) {
    if (!isMissingRawLogTable(err)) {
      logger.error("[indexer events] failed to read recent Ponder raw logs:", err);
    }
    return [];
  }
}

export async function logEventCounts(
  pool: Pool,
  schema: string,
  options: Omit<EventCountLoggerOptions, "intervalMs"> = {},
): Promise<void> {
  const logger = options.logger ?? console;
  const now = options.now ?? (() => new Date());
  const metricsRows = await readPonderEventCountRows(options).catch(() => []);
  if (metricsRows.length > 0) {
    logger.log(`[indexer events] event counts at ${now().toISOString()}`);
    if (typeof logger.table === "function") {
      logger.table(metricsRows);
    } else {
      logger.log(metricsRows);
    }
  } else {
    const rows = await readEventCountRows(pool, schema);
    logger.log(
      `[indexer events] indexed row counts (${schema}) at ${now().toISOString()} (Ponder metrics pending)`,
    );
    if (typeof logger.table === "function") {
      logger.table(rows);
    } else {
      logger.log(rows);
    }
  }

  const rawLogRows = await readPonderRawLogRowsForLogging(pool, options, logger);
  if (rawLogRows.length > 0) {
    logger.log(`[indexer events] recent Ponder raw logs by block at ${now().toISOString()}`);
    if (typeof logger.table === "function") {
      logger.table(rawLogRows);
    } else {
      logger.log(rawLogRows);
    }
  }
}

export function startEventCountLogger(
  pool: Pool,
  schema: string,
  options: EventCountLoggerOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? loadEventCountLogIntervalMs();
  if (intervalMs === null) return () => {};

  const logger = options.logger ?? console;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await logEventCounts(pool, schema, options);
    } catch (err) {
      logger.error("[indexer events] failed to log indexed row counts:", err);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
