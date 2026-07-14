#!/usr/bin/env bun
/**
 * ROBBED_ doc-lint — mechanical documentation checks (no LLM, no npm deps).
 *
 * Run: `bun scripts/doc-check.ts`. Exit 0 when clean; exit 1 with a findings
 * list (file:line  [check]  message) otherwise. The LLM layer on top of this
 * is the /doc-check slash command (.claude/commands/doc-check.md).
 *
 * Checks
 *  a. links     — every relative markdown link/image in *.md (repo root +
 *                 docs/**) resolves to an existing file, and its #anchor (if
 *                 any) to a real heading (GitHub slug rules).
 *  b. (removed)  — the old "spec-ref" gate resolved section-number references
 *                 against the retired spec doc. The design docs cross-link
 *                 by markdown anchor (covered by check a).
 *  c. lp-copy   — canonical LP sentence. Any line in docs/** or README.md
 *                 that starts the sentence ("LP principal permanently
 *                 locked") must carry the full canonical body; and the burn
 *                 heuristic: flag lines containing both LP/liquidity and
 *                 burn* UNLESS the line also contains a negation
 *                 (never/not/forbidden/fallback — plus no/zero/absent, which
 *                 the docs use for "no 'burned' in LP context" style rules).
 *                 Fenced code blocks are exempt (grep recipes, event ABIs).
 *  d. fences    — every ``` fence is closed (balanced per file) and every
 *                 ```mermaid block is non-empty.
 *  e. m0        — if tools/m0/out/constants.json exists, any number in the
 *                 scanned docs annotated with `<!-- m0:dotted.path -->` must
 *                 equal the JSON value at that path. Convention: put the
 *                 marker on the same line, after the number it asserts; the
 *                 nearest numeric literal before the marker is compared
 *                 (exact string, else BigInt/Number equality). Zero markers
 *                 is a pass — the mechanism exists for future M0-derived
 *                 numbers in docs.
 *  f. openapi   — apps/api/openapi.yaml, if present, parses as YAML.
 *  g. env-sync  — `.env.example` ⇄ docs/developers/runbooks/env-inventory.md, both
 *                 directions, driven by the inventory's <!-- env-sync … -->
 *                 markers. Logic lives in scripts/env-sync-check.ts (also
 *                 standalone-runnable and a named validate.sh stage); included
 *                 here so CI's docs job enforces it on every push.
 *  h. docs-placement — the two-bucket docs policy (docs/README.md):
 *                 (h1) forbidden internal-tracker artifacts fail loud — the
 *                      retired paths (docs/implementation-plan.md, docs/plans/,
 *                      docs/decisions.md, docs/development-flow.md,
 *                      docs/traceability.md, docs/review/, docs/archive/) and
 *                      any *.md whose basename matches
 *                      /(implementation-plan|progress|status-report|standup|
 *                      roadmap-tracker)/i anywhere outside .claude/;
 *                 (h2) every *.md under docs/ must be in the sanctioned set —
 *                      docs-root allowlist (README/CONTRIBUTING/SECURITY)
 *                      or a sanctioned subdir (users/, developers/ — the latter
 *                      includes developers/runbooks/);
 *                 (h3) machine-consumed files must exist at the exact paths
 *                      their consumer scripts expect (spec, env-inventory,
 *                      user-flows pair) so a move without re-pointing fails
 *                      HERE with a named error instead of silently disabling
 *                      a gate.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, basename } from "node:path";
import { envSyncFindings } from "./env-sync-check";

const ROOT = resolve(import.meta.dir, "..");

interface Finding {
  file: string; // repo-relative
  line: number; // 1-based; 0 = whole-file
  check: string;
  msg: string;
}
const findings: Finding[] = [];
const report = (file: string, line: number, check: string, msg: string) =>
  findings.push({ file, line, check, msg });

// ── file inventory ───────────────────────────────────────────────────────────

function docsMdFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...docsMdFiles(p));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const rootMd = readdirSync(ROOT)
  .filter((n) => n.endsWith(".md"))
  .map((n) => join(ROOT, n));
const docsMd = existsSync(join(ROOT, "docs")) ? docsMdFiles(join(ROOT, "docs")) : [];
const allMd = [...rootMd, ...docsMd].sort();
const rel = (p: string) => relative(ROOT, p);

// ── markdown model: lines, fence map, headings, section numbers, slugs ──────

interface MdFile {
  path: string;
  lines: string[];
  inFence: boolean[]; // true = line is inside (or opens/closes) a fenced block
  slugs: Set<string>;
  looseSlugs: Set<string>; // slug with hyphens stripped, for near-zero-FP anchor check
  sections: Set<string>; // "6", "6.3", "6.3.2", "12.15", ...
  fenceProblems: { line: number; msg: string }[];
}

// GitHub anchor slug (github-slugger behavior: strip markup + punctuation,
// lowercase, each space -> "-", duplicates get -1, -2, ...).
function slugify(raw: string, taken: Map<string, number>): string {
  let s = raw
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} \-]/gu, "")
    .replace(/ /g, "-");
  const n = taken.get(s) ?? 0;
  taken.set(s, n + 1);
  return n === 0 ? s : `${s}-${n}`;
}

function parseMd(path: string): MdFile {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  const inFence: boolean[] = new Array(lines.length).fill(false);
  const fenceProblems: { line: number; msg: string }[] = [];

  // fence state machine (backtick and tilde fences; closer must match char
  // and be at least as long as the opener)
  let open: { char: string; len: number; line: number; info: string; body: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (open) {
      inFence[i] = true;
      if (m && m[1][0] === open.char && m[1].length >= open.len && m[2].trim() === "") {
        if (open.info === "mermaid" && open.body === 0)
          fenceProblems.push({ line: open.line, msg: "empty ```mermaid block" });
        open = null;
      } else if (lines[i].trim() !== "") {
        open.body++;
      }
    } else if (m) {
      inFence[i] = true;
      open = {
        char: m[1][0],
        len: m[1].length,
        line: i + 1,
        info: m[2].trim().split(/\s+/)[0].toLowerCase(),
        body: 0,
      };
    }
  }
  if (open)
    fenceProblems.push({
      line: open.line,
      msg: `unclosed \`\`\`${open.info || ""} fence (unbalanced fences in file)`.replace("``` ", "``` "),
    });

  // headings -> slugs + numbered sections; numbered list items under the
  // deepest numbered heading extend the section set (numbered decisions,
  // graduation steps, ...)
  const slugs = new Set<string>();
  const looseSlugs = new Set<string>();
  const taken = new Map<string, number>();
  const sections = new Set<string>();
  let currentNum: string | null = null;
  let currentNumLevel = 0; // heading depth (# count) that set currentNum
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue;
    const h = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const slug = slugify(h[2], taken);
      slugs.add(slug);
      looseSlugs.add(slug.replace(/-/g, ""));
      const num = h[2].match(/^(\d+(?:\.\d+)*)[.)]?(?:\s|$)/);
      if (num) {
        currentNum = num[1].replace(/\.$/, "");
        currentNumLevel = level;
        sections.add(currentNum);
        // "## 6.3 ..." also implies "6" is referable territory
        const parts = currentNum.split(".");
        for (let k = 1; k < parts.length; k++) sections.add(parts.slice(0, k).join("."));
      } else if (level <= currentNumLevel) {
        // unnumbered heading at the same or shallower depth ends the numbered
        // scope; a DEEPER unnumbered heading (e.g. a numbered section's "### Integration-
        // seam reconciliation sweep" inside "## 12. Resolved Decisions") is a
        // visual grouping — numbered list items after it still belong to the
        // enclosing numbered section.
        currentNum = null;
        currentNumLevel = 0;
      }
      continue;
    }
    if (currentNum) {
      const li = lines[i].match(/^ {0,3}(\d+)[.)]\s/);
      if (li) sections.add(`${currentNum}.${parseInt(li[1], 10)}`);
    }
  }
  return { path, lines, inFence, slugs, looseSlugs, sections, fenceProblems };
}

const mdFiles = new Map<string, MdFile>();
for (const p of allMd) mdFiles.set(p, parseMd(p));

// strip inline code spans so `[x]` inside backticks can't confuse the
// line-level regexes (positions preserved by padding with spaces)
function stripInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
}

// ── check d: fences ──────────────────────────────────────────────────────────

for (const f of mdFiles.values())
  for (const p of f.fenceProblems) report(rel(f.path), p.line, "fences", p.msg);

// ── check a: relative links + anchors ────────────────────────────────────────

const LINK_RE = /!?\[[^\]]*\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g;
const REFDEF_RE = /^ {0,3}\[[^\]]+\]:\s+(\S+)/;

function checkLinkTarget(f: MdFile, lineNo: number, target: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return; // http:, https:, mailto:, ...
  if (target.startsWith("/")) return; // site-absolute: out of scope, prefer silence
  const [pathPart, ...anchorParts] = target.split("#");
  const anchor = anchorParts.join("#");
  let targetPath = f.path;
  if (pathPart) {
    targetPath = resolve(dirname(f.path), decodeURIComponent(pathPart));
    if (!existsSync(targetPath)) {
      report(rel(f.path), lineNo, "links", `broken link: ${target} (no such file)`);
      return;
    }
  }
  if (!anchor) return;
  if (!targetPath.endsWith(".md") || statSync(targetPath).isDirectory()) return;
  const targetMd = mdFiles.get(targetPath) ?? parseMd(targetPath);
  const a = decodeURIComponent(anchor).toLowerCase();
  if (targetMd.slugs.has(a)) return;
  if (targetMd.looseSlugs.has(a.replace(/-/g, ""))) return; // slugger edge cases: stay silent
  report(rel(f.path), lineNo, "links", `broken anchor: ${target} (no heading "#${anchor}" in ${rel(targetPath)})`);
}

for (const f of mdFiles.values()) {
  for (let i = 0; i < f.lines.length; i++) {
    if (f.inFence[i]) continue;
    const line = stripInlineCode(f.lines[i]);
    const refdef = line.match(REFDEF_RE);
    if (refdef) checkLinkTarget(f, i + 1, refdef[1]);
    for (const m of line.matchAll(LINK_RE)) checkLinkTarget(f, i + 1, m[1]);
  }
}

// (check b "spec-ref" removed with the spec retirement — section-number
//  references are no longer used anywhere; the design docs cross-link by anchor.)

// ── check c: canonical LP sentence + burn-in-LP-context heuristic ────────────

const LP_CANON = "LP principal permanently locked; trading fees claimable by treasury";
// negations per the check contract: never/not/forbidden/fallback; the extra
// no/zero/absent cover the docs' own enforcement prose ("no "burned" in LP
// context", "`burned` absent"). Anything this allowlist lets through is the
// /doc-check LLM layer's problem, not a mechanical finding.
const NEGATION_RE = /\b(never|not|forbidden|fallback|no|zero|absent)\b/i;

for (const f of mdFiles.values()) {
  const r = rel(f.path);
  if (!(r.startsWith("docs/") || r === "README.md")) continue;
  for (let i = 0; i < f.lines.length; i++) {
    if (f.inFence[i]) continue;
    const line = f.lines[i];
    if (/LP principal permanently locked/i.test(line) && !line.includes(LP_CANON))
      report(r, i + 1, "lp-copy", `LP sentence deviates from canonical "${LP_CANON}."`);
    if (/\b(LP|liquidity)\b/i.test(line) && /burn/i.test(line) && !NEGATION_RE.test(line))
      report(r, i + 1, "lp-copy", `"burn" in LP/liquidity context — canonical copy is "${LP_CANON}."`);
  }
}

// ── check e: <!-- m0:KEY --> markers vs tools/m0/out/constants.json ──────────

const CONSTANTS_PATH = join(ROOT, "tools/m0/out/constants.json");
if (existsSync(CONSTANTS_PATH)) {
  const constants = JSON.parse(readFileSync(CONSTANTS_PATH, "utf8"));
  const lookup = (path: string): unknown => {
    let v: any = constants;
    for (const k of path.split(".")) {
      if (v == null || typeof v !== "object") return undefined;
      v = v[k];
    }
    return v;
  };
  const M0_RE = /<!--\s*m0:([\w.-]+)\s*-->/g;
  const NUM_RE = /-?\d[\d_,]*(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  const numsEqual = (raw: string, val: unknown): boolean => {
    const cleaned = raw.replace(/[,_]/g, "");
    const v = String(val);
    if (cleaned === v) return true;
    if (/^-?\d+$/.test(cleaned) && /^-?\d+$/.test(v)) return BigInt(cleaned) === BigInt(v);
    return Number(cleaned) === Number(v);
  };
  for (const f of mdFiles.values()) {
    for (let i = 0; i < f.lines.length; i++) {
      for (const m of f.lines[i].matchAll(M0_RE)) {
        const val = lookup(m[1]);
        if (val === undefined) {
          report(rel(f.path), i + 1, "m0", `m0:${m[1]} — no such key in tools/m0/out/constants.json`);
          continue;
        }
        if (typeof val === "object") {
          report(rel(f.path), i + 1, "m0", `m0:${m[1]} points at an object, not a scalar`);
          continue;
        }
        const nums = [...f.lines[i].slice(0, m.index).matchAll(NUM_RE)];
        if (nums.length === 0) {
          report(rel(f.path), i + 1, "m0", `m0:${m[1]} marker has no numeric literal before it on the line`);
          continue;
        }
        const raw = nums[nums.length - 1][0];
        if (!numsEqual(raw, val))
          report(rel(f.path), i + 1, "m0", `m0:${m[1]} — doc says ${raw}, constants.json says ${String(val)}`);
      }
    }
  }
}

// ── check f: apps/api/openapi.yaml parses as YAML ────────────────────────────

const OPENAPI_PATH = join(ROOT, "apps/api/openapi.yaml");
if (existsSync(OPENAPI_PATH)) {
  const yaml = (Bun as any).YAML;
  if (yaml?.parse) {
    try {
      yaml.parse(readFileSync(OPENAPI_PATH, "utf8"));
    } catch (e: any) {
      report("apps/api/openapi.yaml", 0, "openapi", `YAML parse error: ${e?.message ?? e}`);
    }
  } // older Bun without Bun.YAML: stay silent rather than guess
}

// ── check g: .env.example ⇄ env-inventory sync (scripts/env-sync-check.ts) ──

for (const f of envSyncFindings(ROOT, (m) => console.log(m))) findings.push(f);

// ── check h: docs-placement — two-bucket policy (docs/README.md) ─────────────

// h1a. Retired internal-tracker paths must never come back (removed 2026-07-12;
// no flagship public DeFi repo ships plans/trackers/ledgers — docs/README.md).
const FORBIDDEN_DOC_PATHS = [
  "docs/implementation-plan.md",
  "docs/traceability.md",
  "docs/decisions.md",
  "docs/development-flow.md",
];
const FORBIDDEN_DOC_DIRS = ["docs/plans", "docs/review", "docs/archive"];
for (const p of FORBIDDEN_DOC_PATHS) {
  if (existsSync(join(ROOT, p)))
    report(p, 0, "docs-placement", "retired internal-tracker artifact — do not recreate (docs/README.md placement table)");
}
for (const d of FORBIDDEN_DOC_DIRS) {
  if (existsSync(join(ROOT, d)))
    report(d, 0, "docs-placement", "retired internal-tracker directory — do not recreate (docs/README.md placement table)");
}

// h1b. Tracker-style basenames are forbidden repo-wide (outside .claude/),
// wherever they hide. Walk skips dependency/build/output dirs only.
const FORBIDDEN_BASENAME_RE = /(implementation-plan|progress|status-report|standup|roadmap-tracker)/i;
const WALK_SKIP = new Set([
  ".git", "node_modules", ".next", ".open-next", "dist", "out", "cache",
  "lib", "playwright-report", "test-results", ".idea", ".claude", "coverage", "mutants",
]);
function walkMd(dir: string, acc: string[]): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (WALK_SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walkMd(p, acc);
    else if (e.name.endsWith(".md")) acc.push(p);
  }
  return acc;
}
for (const p of walkMd(ROOT, [])) {
  if (FORBIDDEN_BASENAME_RE.test(basename(p)))
    report(rel(p), 0, "docs-placement", `tracker-style doc basename ("${basename(p)}") — plans/progress/status docs are never committed (docs/README.md)`);
}

// h2. Every *.md under docs/ must be in the sanctioned set (docs/README.md map).
const DOCS_ROOT_MD_ALLOWLIST = new Set([
  "README.md", "CONTRIBUTING.md", "SECURITY.md",
]);
const DOCS_SANCTIONED_SUBDIRS = new Set(["users", "developers"]);
for (const p of docsMd) {
  const r = rel(p); // docs/...
  const parts = r.split("/"); // ["docs", ...]
  const ok =
    (parts.length === 2 && DOCS_ROOT_MD_ALLOWLIST.has(parts[1])) ||
    (parts.length > 2 && DOCS_SANCTIONED_SUBDIRS.has(parts[1]));
  if (!ok)
    report(r, 0, "docs-placement", "not in the sanctioned docs/ set — see the placement table in docs/README.md (protocol + contributor/security docs; test catalogs colocate with tests, security reviews go in the closing PR)");
}

// h3. Machine-consumed files must exist where their consumer scripts point —
// a move without re-pointing fails HERE with a named error, not silently.
const MACHINE_CONSUMED: [string, string][] = [
  ["docs/developers/runbooks/env-inventory.md", "scripts/env-sync-check.ts (env-sync gate)"],
  ["apps/web/e2e/user-flows.md", "scripts/e2e-coverage.ts (e2e coverage gate CATALOG)"],
  ["apps/web/e2e/user-flows-waivers.md", "scripts/e2e-coverage.ts (e2e coverage gate WAIVERS)"],
];
for (const [p, consumer] of MACHINE_CONSUMED) {
  if (!existsSync(join(ROOT, p)))
    report(p, 0, "docs-placement", `machine-consumed file missing — expected by ${consumer}; if it moved, re-point the consumer AND this list in the same change (docs/README.md)`);
}

// ── report ───────────────────────────────────────────────────────────────────

if (findings.length === 0) {
  console.log(`doc-check: clean (${allMd.length} markdown files)`);
  process.exit(0);
}
findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
for (const f of findings) console.log(`${f.file}:${f.line}  [${f.check}]  ${f.msg}`);
console.log(`\ndoc-check: ${findings.length} finding(s) across ${allMd.length} markdown files`);
process.exit(1);
