/**
 * STRUCTURAL guarantee (indexer.md §8.3, api.md §6.5): the WS fanout module is
 * on the <500ms hot path and must never touch the database — truth is served by
 * REST, WS is freshness only. If someone later wires a DB client into the fanout
 * tier this fails at CI before it can ship.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const wsText = readFileSync(join(import.meta.dir, "..", "src", "ws.ts"), "utf8");

/** DB / persistence primitives that must never reach the fanout module. */
const FORBIDDEN_DB = [
  "./lib/db",
  "../lib/db",
  "db.bun",
  "createBunDb",
  "Bun.sql",
  'from "pg"',
  "deps.db",
  "AppDeps",
  "getTokenDetailRow",
  "listTrades",
];

describe("ws.ts — no database import on the fanout hot path", () => {
  for (const token of FORBIDDEN_DB) {
    it(`does not reference \`${token}\``, () => {
      expect(wsText.includes(token)).toBe(false);
    });
  }

  it("imports only from @robbed/shared (plus node/bun builtins)", () => {
    const imports = [...wsText.matchAll(/from ["']([^"']+)["']/g)].map((m) => m[1]!);
    for (const spec of imports) {
      expect(spec.startsWith("@robbed/shared") || spec.startsWith("node:")).toBe(true);
    }
  });
});
