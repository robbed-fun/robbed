#!/usr/bin/env bun
/**
 * hoodpad doc-lint — mechanical documentation checks (no LLM, no npm deps).
 *
 * Run: `bun scripts/doc-check.ts`. Exit 0 when clean; exit 1 with a findings
 * list (file:line  [check]  message) otherwise. The LLM layer on top of this
 * is the /doc-check slash command (.claude/commands/doc-check.md).
 *
 * Checks
 *  a. links     — every relative markdown link/image in *.md (repo root +
 *                 docs/**) resolves to an existing file, and its #anchor (if
 *                 any) to a real heading (GitHub slug rules).
 *  b. spec-ref  — every §N / §N.M / §N.M.K reference in docs/** resolves to a
 *                 section that exists. Valid targets: numbered headings in
 *                 launchpad-spec.md plus numbered list items scoped under them
 *                 (so §12.15 = decision 15 under "## 12", §6.3.2 = step 2
 *                 under "### 6.3"). Docs also use § for their OWN sections
 *                 ("see §3.4 of this doc") and for other docs named on the
 *                 same line ("contracts.md §2.3/§2.4", "development-flow
 *                 §5.8"), so a bare reference is accepted if it exists in the
 *                 spec OR the containing file OR any doc mentioned (by
 *                 basename, with or without .md) earlier in the same line. A
 *                 reference immediately preceded by "<name>.md" is resolved
 *                 strictly against that named doc; one immediately preceded
 *                 by the word "spec" strictly against launchpad-spec.md.
 *                 Limitation (deliberate, to keep false positives near
 *                 zero): a bare ref that is broken as a spec ref but happens
 *                 to exist under a doc name mentioned anywhere on the line —
 *                 or as a local section — is not flagged.
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
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, basename } from "node:path";

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
  // deepest numbered heading extend the section set (spec §12 decisions,
  // §6.3 graduation steps, ...)
  const slugs = new Set<string>();
  const looseSlugs = new Set<string>();
  const taken = new Map<string, number>();
  const sections = new Set<string>();
  let currentNum: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue;
    const h = lines[i].match(/^#{1,6}\s+(.*)$/);
    if (h) {
      const slug = slugify(h[1], taken);
      slugs.add(slug);
      looseSlugs.add(slug.replace(/-/g, ""));
      const num = h[1].match(/^(\d+(?:\.\d+)*)[.)]?(?:\s|$)/);
      currentNum = num ? num[1].replace(/\.$/, "") : null;
      if (currentNum) {
        sections.add(currentNum);
        // "## 6.3 ..." also implies "6" is referable territory
        const parts = currentNum.split(".");
        for (let k = 1; k < parts.length; k++) sections.add(parts.slice(0, k).join("."));
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

const SPEC_PATH = join(ROOT, "launchpad-spec.md");
const spec = mdFiles.get(SPEC_PATH);

// strip inline code spans so `[x]` / `§y` inside backticks can't confuse the
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

// ── check b: § references in docs/** ─────────────────────────────────────────

const SECREF_RE = /§\s?(\d+(?:\.\d+)*)/g;

function findNamedDoc(name: string, fromDir: string): MdFile | null {
  const candidates = [
    resolve(fromDir, name),
    join(ROOT, name),
    join(ROOT, "docs", name),
    join(ROOT, "docs", "services", name),
  ];
  for (const c of candidates) {
    if (mdFiles.has(c)) return mdFiles.get(c)!;
    if (existsSync(c) && c.endsWith(".md")) return parseMd(c);
  }
  return null; // named doc we can't locate: stay silent
}

// doc tokens ("contracts.md", "contracts", "development-flow", ...) -> files,
// so "contracts.md §2.3/§2.4" and "development-flow §5.8" resolve against the
// doc named on the line even when the ref itself isn't adjacent to the name
const docByToken = new Map<string, MdFile[]>();
for (const f of mdFiles.values()) {
  const base = basename(f.path).toLowerCase();
  for (const t of [base, base.replace(/\.md$/, "")]) {
    docByToken.set(t, [...(docByToken.get(t) ?? []), f]);
  }
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const docTokenRes = [...docByToken.keys()].map(
  (t) => [new RegExp(`(?:^|[^\\w.-])${escapeRe(t)}(?![\\w-])`, "i"), docByToken.get(t)!] as const,
);

for (const f of mdFiles.values()) {
  if (!rel(f.path).startsWith("docs/")) continue;
  for (let i = 0; i < f.lines.length; i++) {
    const line = f.lines[i]; // fenced lines included: § refs in code comments are real refs
    if (!line.includes("§")) continue;
    let lineDocs: MdFile[] | null = null; // lazily computed
    for (const m of line.matchAll(SECREF_RE)) {
      const ref = m[1];
      const before = line.slice(Math.max(0, m.index! - 40), m.index!);
      const named = before.match(/([\w./-]+\.md)[`'")\]]*[\s(]*$/);
      let ok: boolean;
      let where: string;
      if (named && basename(named[1]) !== "launchpad-spec.md") {
        const doc = findNamedDoc(named[1], dirname(f.path));
        if (!doc) continue;
        ok = doc.sections.has(ref);
        where = named[1];
      } else if (named || /\bspec['’s]*[\s:(]*$/i.test(before)) {
        ok = spec?.sections.has(ref) ?? true;
        where = "launchpad-spec.md";
      } else {
        ok = (spec?.sections.has(ref) ?? true) || f.sections.has(ref);
        if (!ok) {
          lineDocs ??= docTokenRes.filter(([re]) => re.test(line)).flatMap(([, docs]) => docs);
          ok = lineDocs.some((d) => d.sections.has(ref));
        }
        where = "launchpad-spec.md (or this file / a doc named on the line)";
      }
      if (!ok) report(rel(f.path), i + 1, "spec-ref", `§${ref} does not resolve to any section of ${where}`);
    }
  }
}

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

// ── report ───────────────────────────────────────────────────────────────────

if (findings.length === 0) {
  console.log(`doc-check: clean (${allMd.length} markdown files)`);
  process.exit(0);
}
findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
for (const f of findings) console.log(`${f.file}:${f.line}  [${f.check}]  ${f.msg}`);
console.log(`\ndoc-check: ${findings.length} finding(s) across ${allMd.length} markdown files`);
process.exit(1);
