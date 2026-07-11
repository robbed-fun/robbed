#!/usr/bin/env bun
/**
 * ROBBED_ env-sync check — `.env.example` ⇄ docs/runbooks/env-inventory.md
 * (implementation-plan P-1 / G-9 env leg; CLAUDE.md anti-drift spirit: env vars
 * are documented ONCE, in the inventory, and the per-app examples mirror it).
 *
 * Run: `bun scripts/env-sync-check.ts`. Exit 0 when clean. Also invoked from
 * scripts/doc-check.ts (which CI's docs job runs) and validate.sh (`env-sync`).
 *
 * Contract (driven by markers inside env-inventory.md — the doc owns policy):
 *
 *   <!-- env-sync file=apps/indexer/.env.example -->
 *     The table rows following the marker (until the next heading) are synced
 *     against that file, BOTH directions:
 *       d1: every uncommented KEY= in the example must match an inventory row
 *           (exact, or `PREFIX_*` wildcard row) — catches undocumented vars;
 *       d2: every non-skip exact row must appear as a key in the example, and
 *           every non-skip wildcard row must match ≥1 key — catches example
 *           rot. A row carrying `sync:skip` (HTML comment in the row) is
 *           documented-but-knowingly-absent; the row text names the owner.
 *     `allow-missing` on the marker: a missing example file is reported as a
 *     notice, not a failure (used while apps/api/.env.example is unauthored —
 *     routed to robbed-indexer). The check engages when the file appears.
 *
 *   <!-- env-sync-root file=.env.example -->
 *     Direction-1-only union check: every key in the workspace template must
 *     be documented SOMEWHERE in the inventory (any table's first cell).
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export interface EnvSyncFinding {
  file: string; // repo-relative
  line: number; // 1-based; 0 = whole-file
  check: string; // always "env-sync"
  msg: string;
}

const INVENTORY = "docs/runbooks/env-inventory.md";

interface Row {
  name: string; // e.g. "REDIS_URL" or "FLOW_*"
  wildcard: boolean;
  skip: boolean;
  line: number; // 1-based line in the inventory
}

interface Section {
  file: string; // target .env.example (repo-relative)
  allowMissing: boolean;
  markerLine: number;
  rows: Row[];
}

const ROW_TOKEN_RE = /`([A-Z][A-Z0-9_]*(?:_\*|\*)?)`/g;

function parseInventory(text: string): {
  sections: Section[];
  rootFiles: { file: string; markerLine: number }[];
  unionRows: Row[];
} {
  const lines = text.split("\n");
  const sections: Section[] = [];
  const rootFiles: { file: string; markerLine: number }[] = [];
  const unionRows: Row[] = [];
  let current: Section | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sec = line.match(/^<!--\s*env-sync\s+file=(\S+)( +allow-missing)?\s*-->/);
    const root = line.match(/^<!--\s*env-sync-root\s+file=(\S+)\s*-->/);
    if (sec) {
      current = { file: sec[1], allowMissing: !!sec[2], markerLine: i + 1, rows: [] };
      sections.push(current);
      continue;
    }
    if (root) {
      rootFiles.push({ file: root[1], markerLine: i + 1 });
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      current = null; // a heading ends the marker's table scope
    }
    if (!line.startsWith("|")) continue;
    const firstCell = line.split("|")[1] ?? "";
    for (const m of firstCell.matchAll(ROW_TOKEN_RE)) {
      const raw = m[1];
      const row: Row = {
        name: raw,
        wildcard: raw.endsWith("*"),
        skip: /sync:skip/.test(line),
        line: i + 1,
      };
      unionRows.push(row);
      current?.rows.push(row);
    }
  }
  return { sections, rootFiles, unionRows };
}

function envKeys(text: string): { key: string; line: number }[] {
  const out: { key: string; line: number }[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Z][A-Z0-9_]*)=/);
    if (m) out.push({ key: m[1], line: i + 1 });
  }
  return out;
}

const matches = (row: Row, key: string): boolean =>
  row.wildcard ? key.startsWith(row.name.slice(0, -1)) : row.name === key;

export function envSyncFindings(root: string, notice: (msg: string) => void = () => {}): EnvSyncFinding[] {
  const findings: EnvSyncFinding[] = [];
  const invPath = join(root, INVENTORY);
  if (!existsSync(invPath)) {
    findings.push({ file: INVENTORY, line: 0, check: "env-sync", msg: "inventory file missing" });
    return findings;
  }
  const { sections, rootFiles, unionRows } = parseInventory(readFileSync(invPath, "utf8"));
  if (sections.length === 0)
    findings.push({
      file: INVENTORY,
      line: 0,
      check: "env-sync",
      msg: "no <!-- env-sync file=… --> markers found — the G-9 env-leg check is inert",
    });

  for (const s of sections) {
    const p = join(root, s.file);
    if (!existsSync(p)) {
      if (s.allowMissing) {
        notice(`env-sync: ${s.file} not authored yet (allow-missing — routed in the inventory; check engages when it lands)`);
        continue;
      }
      findings.push({ file: INVENTORY, line: s.markerLine, check: "env-sync", msg: `${s.file} does not exist` });
      continue;
    }
    const keys = envKeys(readFileSync(p, "utf8"));
    // d1: every example key documented
    for (const k of keys) {
      if (!s.rows.some((r) => matches(r, k.key)))
        findings.push({
          file: s.file,
          line: k.line,
          check: "env-sync",
          msg: `\`${k.key}\` has no row in ${INVENTORY} (section for ${s.file}) — document it (purpose/secret?/source/owner/dev/testnet/prod) before use`,
        });
    }
    // d2: every non-skip row present in the example
    for (const r of s.rows) {
      if (r.skip) continue;
      const hit = keys.some((k) => matches(r, k.key));
      if (!hit)
        findings.push({
          file: INVENTORY,
          line: r.line,
          check: "env-sync",
          msg: `row \`${r.name}\` not present in ${s.file} — add the key there, or mark the row \`sync:skip\` with an owner note`,
        });
    }
  }

  for (const rf of rootFiles) {
    const p = join(root, rf.file);
    if (!existsSync(p)) {
      findings.push({ file: INVENTORY, line: rf.markerLine, check: "env-sync", msg: `${rf.file} does not exist` });
      continue;
    }
    for (const k of envKeys(readFileSync(p, "utf8"))) {
      if (!unionRows.some((r) => matches(r, k.key)))
        findings.push({
          file: rf.file,
          line: k.line,
          check: "env-sync",
          msg: `\`${k.key}\` is not documented anywhere in ${INVENTORY} — add a row in the owning service's section (or §5 dev/test tooling)`,
        });
    }
  }
  return findings;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const findings = envSyncFindings(root, (m) => console.log(m));
  if (findings.length === 0) {
    console.log("env-sync: clean");
    process.exit(0);
  }
  for (const f of findings) console.log(`${f.file}:${f.line}  [${f.check}]  ${f.msg}`);
  console.log(`\nenv-sync: ${findings.length} finding(s)`);
  process.exit(1);
}
