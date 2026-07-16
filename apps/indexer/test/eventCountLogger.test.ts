import { describe, expect, it } from "bun:test";
import type { Pool } from "pg";
import { tokenCreatedEvent, tradeEvent } from "@robbed/shared/abi";
import { toEventSelector, type AbiEvent } from "viem";
import {
  DEFAULT_EVENT_COUNTS_LOG_MS,
  DEFAULT_PONDER_RAW_LOG_BLOCKS,
  DEFAULT_PONDER_RAW_LOG_MAX_ROWS,
  EVENT_COUNT_SOURCES,
  loadEventCountLogIntervalMs,
  loadPonderRawLogConfig,
  logEventCounts,
  parsePonderIndexingMetrics,
  readEventCountRows,
  readPonderRawLogBlockRows,
} from "../src/eventCountLogger";

function fakePool(rows: Array<{ count: string; last_block: string | null } | Error>) {
  const queries: string[] = [];
  const pool = {
    async query(text: string) {
      queries.push(text);
      const next = rows.shift();
      if (next instanceof Error) throw next;
      return { rows: [next ?? { count: "0", last_block: null }] };
    },
  } as unknown as Pool;

  return { pool, queries };
}

function fakeRowsPool(rows: unknown[]) {
  const queries: Array<{ text: string; values: unknown[] | undefined }> = [];
  const pool = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return { rows };
    },
  } as unknown as Pool;

  return { pool, queries };
}

describe("loadEventCountLogIntervalMs", () => {
  it("defaults to the always-visible compose cadence", () => {
    expect(loadEventCountLogIntervalMs({})).toBe(DEFAULT_EVENT_COUNTS_LOG_MS);
  });

  it("can be disabled explicitly", () => {
    expect(loadEventCountLogIntervalMs({ INDEXER_EVENT_COUNTS_LOG_MS: "0" })).toBeNull();
    expect(loadEventCountLogIntervalMs({ INDEXER_EVENT_COUNTS_LOG_MS: "off" })).toBeNull();
  });

  it("rejects sub-second or non-integer cadences", () => {
    expect(() => loadEventCountLogIntervalMs({ INDEXER_EVENT_COUNTS_LOG_MS: "999" })).toThrow();
    expect(() => loadEventCountLogIntervalMs({ INDEXER_EVENT_COUNTS_LOG_MS: "wat" })).toThrow();
  });
});

describe("loadPonderRawLogConfig", () => {
  it("defaults to a bounded readable raw-log table", () => {
    expect(loadPonderRawLogConfig({})).toEqual({
      blocks: DEFAULT_PONDER_RAW_LOG_BLOCKS,
      maxRows: DEFAULT_PONDER_RAW_LOG_MAX_ROWS,
      chainId: null,
    });
  });

  it("uses the optional chain id filter when it is available", () => {
    expect(loadPonderRawLogConfig({ INDEXER_CHAIN_ID: "4663" })?.chainId).toBe(4663);
  });

  it("can be disabled without disabling the aggregate event-count table", () => {
    expect(loadPonderRawLogConfig({ INDEXER_PONDER_RAW_LOG_BLOCKS: "0" })).toBeNull();
    expect(loadPonderRawLogConfig({ INDEXER_PONDER_RAW_LOG_MAX_ROWS: "off" })).toBeNull();
  });

  it("rejects unbounded raw-log table settings", () => {
    expect(() => loadPonderRawLogConfig({ INDEXER_PONDER_RAW_LOG_BLOCKS: "999" })).toThrow();
    expect(() => loadPonderRawLogConfig({ INDEXER_PONDER_RAW_LOG_MAX_ROWS: "9999" })).toThrow();
  });
});

describe("readEventCountRows", () => {
  it("returns a table row for every indexed event family plus TOTAL", async () => {
    const { pool, queries } = fakePool(
      EVENT_COUNT_SOURCES.map((_, i) => ({
        count: String(i + 1),
        last_block: String(100 + i),
      })),
    );

    const rows = await readEventCountRows(pool, "robbed_mainnet_ponder");

    expect(rows.map((row) => row.Event)).toEqual([
      ...EVENT_COUNT_SOURCES.map((source) => source.event),
      "TOTAL",
    ]);
    expect(rows.at(-1)).toEqual({
      Event: "TOTAL",
      Table: "persisted event rows",
      Count: "21",
      "Last block": "105",
    });
    expect(queries.every((query) => query.includes('"robbed_mainnet_ponder"'))).toBe(true);
  });

  it("keeps the table visible while Ponder tables are still pending", async () => {
    const { pool } = fakePool([
      new Error("relation does not exist"),
      ...EVENT_COUNT_SOURCES.slice(1).map(() => ({ count: "2", last_block: "7" })),
    ]);

    const rows = await readEventCountRows(pool, "public");

    expect(rows[0]).toEqual({
      Event: "CurveFactory:TokenCreated",
      Table: "tokens",
      Count: "pending",
      "Last block": "-",
    });
    expect(rows.at(-1)?.Count).toBe("10");
  });
});

describe("parsePonderIndexingMetrics", () => {
  it("restores the Ponder Event / Count / Duration table from Prometheus metrics", () => {
    const rows = parsePonderIndexingMetrics(`
# HELP ponder_indexing_completed_events Number of events that have been processed
ponder_indexing_completed_events{chain="robinhood",event="BondingCurve:Trade"} 3
ponder_indexing_completed_events{chain="robinhood",event="CurveFactory:TokenCreated"} 1
# HELP ponder_indexing_function_duration Duration of indexing function execution
ponder_indexing_function_duration_sum{chain="robinhood",event="BondingCurve:Trade"} 1.5
ponder_indexing_function_duration_count{chain="robinhood",event="BondingCurve:Trade"} 3
ponder_indexing_function_duration_sum{chain="robinhood",event="CurveFactory:TokenCreated"} 0.0002
ponder_indexing_function_duration_count{chain="robinhood",event="CurveFactory:TokenCreated"} 1
`);

    expect(rows).toEqual([
      { Event: "CurveFactory:TokenCreated", Count: "1", "Duration (ms)": "<0.001" },
      { Event: "BondingCurve:Trade", Count: "3", "Duration (ms)": "0.500" },
    ]);
  });
});

describe("readPonderRawLogBlockRows", () => {
  it("summarizes recent ponder_sync.logs rows by block with known topic names", async () => {
    const unknownTopic = `0x${"1".repeat(64)}`;
    const { pool, queries } = fakeRowsPool([
      {
        block_number: "102",
        chain_id: "4663",
        address: "0xaaaa000000000000000000000000000000000001",
        topic0: toEventSelector(tradeEvent as AbiEvent),
        transaction_hash: "0xaaaa",
        block_log_count: "3",
      },
      {
        block_number: "102",
        chain_id: "4663",
        address: "0xaaaa000000000000000000000000000000000001",
        topic0: toEventSelector(tradeEvent as AbiEvent),
        transaction_hash: "0xaaaa",
        block_log_count: "3",
      },
      {
        block_number: "102",
        chain_id: "4663",
        address: "0xbbbb000000000000000000000000000000000002",
        topic0: unknownTopic,
        transaction_hash: "0xbbbb",
        block_log_count: "3",
      },
      {
        block_number: "101",
        chain_id: "4663",
        address: "0xcccc000000000000000000000000000000000003",
        topic0: toEventSelector(tokenCreatedEvent as AbiEvent),
        transaction_hash: "0xcccc",
        block_log_count: "1",
      },
    ]);

    const rows = await readPonderRawLogBlockRows(pool, {
      rawLogBlocks: 2,
      rawLogMaxRows: 10,
      chainId: 4663,
    });

    expect(queries[0]?.text).toContain("ponder_sync.logs");
    expect(queries[0]?.text).toContain("chain_id = $1::bigint");
    expect(queries[0]?.values).toEqual([4663, 2, 10]);
    expect(rows).toEqual([
      {
        Block: "102",
        Chain: "4663",
        Logs: "3",
        Txs: "2",
        Contracts: "2",
        Events: "BondingCurve:Trade x2",
        "Unknown topics": "0x11111111...111111",
      },
      {
        Block: "101",
        Chain: "4663",
        Logs: "1",
        Txs: "1",
        Contracts: "1",
        Events: "CurveFactory:TokenCreated",
        "Unknown topics": "-",
      },
    ]);
  });

  it("marks a block summary as capped when max rows cuts through the block", async () => {
    const { pool } = fakeRowsPool([
      {
        block_number: "102",
        chain_id: "4663",
        address: "0xaaaa000000000000000000000000000000000001",
        topic0: toEventSelector(tradeEvent as AbiEvent),
        transaction_hash: "0xaaaa",
        block_log_count: "5",
      },
      {
        block_number: "102",
        chain_id: "4663",
        address: "0xbbbb000000000000000000000000000000000002",
        topic0: toEventSelector(tradeEvent as AbiEvent),
        transaction_hash: "0xbbbb",
        block_log_count: "5",
      },
    ]);

    const rows = await readPonderRawLogBlockRows(pool, {
      rawLogBlocks: 1,
      rawLogMaxRows: 2,
      chainId: 4663,
    });

    expect(rows[0]?.Logs).toBe("2/5");
  });
});

describe("logEventCounts", () => {
  it("prints the raw-log block table after the Ponder metrics count table", async () => {
    const { pool } = fakeRowsPool([
      {
        block_number: "102",
        chain_id: "4663",
        address: "0xaaaa000000000000000000000000000000000001",
        topic0: toEventSelector(tradeEvent as AbiEvent),
        transaction_hash: "0xaaaa",
        block_log_count: "1",
      },
    ]);
    const logs: unknown[] = [];
    const tables: unknown[] = [];
    const logger = {
      error: (...args: unknown[]) => logs.push(args),
      log: (...args: unknown[]) => logs.push(args),
      table: (value: unknown) => tables.push(value),
    };

    await logEventCounts(pool, "public", {
      metricsUrl: "http://metrics.example",
      fetchMetrics: async () => 'ponder_indexing_completed_events{event="BondingCurve:Trade"} 1',
      rawLogBlocks: 1,
      rawLogMaxRows: 10,
      chainId: 4663,
      logger,
      now: () => new Date("2026-07-16T00:00:00.000Z"),
    });

    expect(tables).toHaveLength(2);
    expect(tables[0]).toEqual([{ Event: "BondingCurve:Trade", Count: "1", "Duration (ms)": "-" }]);
    expect(tables[1]).toEqual([
      {
        Block: "102",
        Chain: "4663",
        Logs: "1",
        Txs: "1",
        Contracts: "1",
        Events: "BondingCurve:Trade",
        "Unknown topics": "-",
      },
    ]);
    expect(
      logs.flat().some((entry) => String(entry).includes("recent Ponder raw logs by block")),
    ).toBe(true);
  });
});
