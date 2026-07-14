/**
 * M2-9 search builder. All four field classes + address-mode
 * detection + ticker-boost / volume-tiebreak / similarity-floor ordering.
 */
import { describe, expect, it } from "bun:test";
import { buildSearchQuery, detectMode } from "../src/search/builder";
import { loadRankingConfig } from "../src/config/ranking";

const cfg = loadRankingConfig();

describe("detectMode", () => {
  it("treats 0x-prefixed hex 6..40 as address mode", () => {
    expect(detectMode("0xabc123")).toBe("address");
    expect(detectMode("0x" + "a".repeat(40))).toBe("address");
  });
  it("treats plain text and short 0x as similarity mode", () => {
    expect(detectMode("doge")).toBe("similarity");
    expect(detectMode("0xab")).toBe("similarity"); // < 6 hex
    expect(detectMode("PEPE")).toBe("similarity");
  });
});

describe("buildSearchQuery — address mode", () => {
  const built = buildSearchQuery("0xABCdef", 20, cfg);
  it("is address mode and lowercases the needle", () => {
    expect(built.mode).toBe("address");
    expect(built.query.params[0]).toBe("0xabcdef"); // exact (lowercased)
    expect(built.query.params[1]).toBe("0xabcdef%"); // prefix
  });
  it("matches BOTH address and creator, pins exact first, volume tiebreak", () => {
    const sql = built.query.text;
    expect(sql).toContain("t.address = $1");
    expect(sql).toContain("t.address LIKE $2");
    expect(sql).toContain("t.creator LIKE $2");
    expect(sql).toContain("ORDER BY (t.address = $1) DESC, t.volume_eth_24h DESC");
  });
  it("excludes hidden listings", () => {
    expect(built.query.text).toContain("visibility IS DISTINCT FROM 'hidden'");
  });
});

describe("buildSearchQuery — similarity mode", () => {
  const built = buildSearchQuery("doge", 15, cfg);
  it("covers name + ticker trigram AND address/creator prefix (all four fields)", () => {
    const sql = built.query.text;
    expect(sql).toContain("t.name % $1");
    expect(sql).toContain("t.ticker % $1");
    expect(sql).toContain("t.address LIKE $4");
    expect(sql).toContain("t.creator LIKE $4");
  });
  it("applies ticker boost, volume tiebreak, and similarity floor from config", () => {
    const sql = built.query.text;
    expect(sql).toContain("similarity(t.ticker, $1) * $2"); // boost
    expect(sql).toContain("ORDER BY _score DESC, t.volume_eth_24h DESC");
    expect(built.query.params[1]).toBe(cfg.tickerBoost);
    expect(built.query.params[2]).toBe(cfg.similarityFloor);
  });
  it("passes the limit through", () => {
    expect(built.query.params[4]).toBe(15);
  });
});
