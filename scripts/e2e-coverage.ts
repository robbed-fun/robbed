#!/usr/bin/env bun
/**
 * ── e2e:coverage — the static flow-coverage gate (plan I-5a) ─────────────────
 *
 * Diffs the flow catalog (`docs/user-flows.md`) against the `@flow`-tagged
 * Playwright specs (`apps/web/e2e/flows/*.spec.ts`) and asserts that EACH tagged
 * spec asserts EXACTLY its declared `assertable-layers` (on-chain/indexed/UI),
 * honouring `docs/user-flows-waivers.md`. Exits non-zero on any:
 *   - catalog ID with no `@flow`-tagged spec (uncovered)
 *   - spec whose asserted layers ⊂ declared (under-asserted)
 *   - spec whose asserted layers ⊃ declared (over-asserted)
 *   - `@flow` tag referencing an ID not in the catalog (orphan)
 *   - catalog/waiver declared-layers disagreement (doc inconsistency)
 *
 * The gate is PURELY STATIC — it parses files only and MUST pass even with no
 * running stack (RUN-OR-AUTHOR). Run: `bun run e2e:coverage`.
 *
 * Layer↔marker contract (harness/layers.ts): on-chain→`assertOnChain(`,
 * indexed→`assertIndexed(`, ui→`assertUi(`. A spec "asserts" a layer iff it
 * calls the matching marker at least once.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CATALOG = join(ROOT, "docs/user-flows.md");
const WAIVERS = join(ROOT, "docs/user-flows-waivers.md");
const FLOWS_DIR = join(ROOT, "apps/web/e2e/flows");

type Layer = "on-chain" | "indexed" | "ui";
const ALL_LAYERS: Layer[] = ["on-chain", "indexed", "ui"];

const MARKER: Record<Layer, string> = {
  "on-chain": "assertOnChain(",
  indexed: "assertIndexed(",
  ui: "assertUi(",
};

function normLayers(raw: string): Layer[] {
  const out = new Set<Layer>();
  // Cut off any trailing prose / italic rationale after the layer list.
  const head = raw.split(/[._]/)[0] ?? raw;
  for (const tok of head.split(/[·,]/).map((t) => t.trim().toLowerCase())) {
    if (tok === "on-chain") out.add("on-chain");
    else if (tok === "indexed") out.add("indexed");
    else if (tok === "ui") out.add("ui");
  }
  return ALL_LAYERS.filter((l) => out.has(l));
}

function setEq(a: Layer[], b: Layer[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

// ── 1. parse the catalog: heading `@flow:ID` → its assertable-layers line ─────

function parseCatalog(): Map<string, Layer[]> {
  const lines = readFileSync(CATALOG, "utf8").split("\n");
  const map = new Map<string, Layer[]>();
  let current: string | null = null;
  for (const line of lines) {
    const h = /^#{2,4}\s+.*@flow:([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)/.exec(line);
    if (h) {
      current = h[1]!;
      continue;
    }
    const al = /^\s*-\s+\*\*assertable-layers:\*\*\s+(.+)$/.exec(line);
    if (al && current) {
      map.set(current, normLayers(al[1]!));
      current = null;
    }
  }
  return map;
}

// ── 2. parse the waivers table (declared-layers column) for cross-check ───────

function parseWaivers(): Map<string, Layer[]> {
  const lines = readFileSync(WAIVERS, "utf8").split("\n");
  const map = new Map<string, Layer[]>();
  for (const line of lines) {
    // | `ERR-1` | on-chain · UI | indexed | Slippage revert … |
    const m = /^\|\s*`([A-Za-z0-9-]+)`\s*\|\s*([^|]+)\|/.exec(line);
    if (m) map.set(m[1]!, normLayers(m[2]!));
  }
  return map;
}

// ── 3. parse the specs: `@flow:ID` tag(s) + asserted-layer markers ────────────

interface SpecInfo {
  file: string;
  flows: string[];
  layers: Layer[];
}

function parseSpecs(): SpecInfo[] {
  let files: string[];
  try {
    files = readdirSync(FLOWS_DIR).filter((f) => f.endsWith(".spec.ts"));
  } catch {
    return [];
  }
  return files.map((f) => {
    const text = readFileSync(join(FLOWS_DIR, f), "utf8");
    const flows = [...text.matchAll(/@flow:([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)/g)].map((m) => m[1]!);
    const layers = ALL_LAYERS.filter((l) => text.includes(MARKER[l]));
    return { file: f, flows: [...new Set(flows)], layers };
  });
}

// ── 4. reconcile + report ─────────────────────────────────────────────────────

function main(): void {
  const catalog = parseCatalog();
  const waivers = parseWaivers();
  const specs = parseSpecs();

  const errors: string[] = [];

  // 4a. catalog ↔ waivers consistency (honour the waivers file)
  for (const [id, declared] of catalog) {
    const w = waivers.get(id);
    if (declared.length < 3) {
      if (!w) {
        errors.push(`DOC: ${id} declares <3 layers in the catalog but has NO waiver row.`);
      } else if (!setEq(declared, w)) {
        errors.push(
          `DOC: ${id} layers disagree — catalog [${declared.join(",")}] vs waiver [${w.join(",")}].`,
        );
      }
    } else if (w) {
      errors.push(`DOC: ${id} is full-3-layer in the catalog but has a waiver row.`);
    }
  }

  // 4b. build spec-by-flow index; detect orphan tags + duplicate coverage
  const specByFlow = new Map<string, SpecInfo[]>();
  for (const s of specs) {
    if (s.flows.length === 0) {
      errors.push(`SPEC: ${s.file} has no @flow:<ID> tag.`);
      continue;
    }
    for (const id of s.flows) {
      if (!catalog.has(id)) errors.push(`SPEC: ${s.file} tags unknown flow @flow:${id}.`);
      const arr = specByFlow.get(id) ?? [];
      arr.push(s);
      specByFlow.set(id, arr);
    }
  }

  // 4c. every catalog ID covered with EXACTLY its declared layers
  const covered: string[] = [];
  for (const [id, declared] of [...catalog].sort()) {
    const matched = specByFlow.get(id);
    if (!matched || matched.length === 0) {
      errors.push(`UNCOVERED: ${id} — no @flow-tagged spec (declares [${declared.join(", ")}]).`);
      continue;
    }
    if (matched.length > 1) {
      errors.push(`DUPLICATE: ${id} tagged by ${matched.map((m) => m.file).join(", ")}.`);
    }
    const spec = matched[0]!;
    // Only consider markers if this spec covers a SINGLE flow (1:1 rule); a
    // multi-flow spec can't attribute markers per flow.
    const asserted = spec.flows.length === 1 ? spec.layers : spec.layers;
    if (spec.flows.length !== 1) {
      errors.push(`SPEC: ${spec.file} must cover exactly one flow (has ${spec.flows.join(", ")}).`);
    }
    const missing = declared.filter((l) => !asserted.includes(l));
    const extra = asserted.filter((l) => !declared.includes(l));
    if (missing.length) {
      errors.push(
        `UNDER-ASSERTED: ${id} (${spec.file}) missing layer(s) [${missing.join(", ")}] — ` +
          `declared [${declared.join(", ")}], asserts [${asserted.join(", ")}].`,
      );
    }
    if (extra.length) {
      errors.push(
        `OVER-ASSERTED: ${id} (${spec.file}) asserts undeclared layer(s) [${extra.join(", ")}] — ` +
          `declared [${declared.join(", ")}] (drop the marker or fix the catalog/waiver).`,
      );
    }
    if (!missing.length && !extra.length && spec.flows.length === 1) covered.push(id);
  }

  // ── report ──────────────────────────────────────────────────────────────────
  const total = catalog.size;
  console.log(`\nROBBED_ e2e flow coverage — ${covered.length}/${total} flows fully covered\n`);
  for (const [id, declared] of [...catalog].sort()) {
    const spec = specByFlow.get(id)?.[0];
    const ok = covered.includes(id);
    const mark = ok ? "PASS" : spec ? "FAIL" : "MISS";
    console.log(
      `  [${mark}] ${id.padEnd(10)} declared: ${declared.join(" · ").padEnd(26)} ` +
        `${spec ? `→ ${spec.file}` : "→ (no spec)"}`,
    );
  }

  if (errors.length) {
    console.error(`\n${errors.length} problem(s):\n`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error(
      `\ne2e:coverage FAILED — every catalog ID needs a 1:1 @flow spec asserting exactly its declared layers.\n`,
    );
    process.exit(1);
  }

  console.log(`\ne2e:coverage PASSED — all ${total} catalog flows covered with exact layer assertions.\n`);
}

main();
