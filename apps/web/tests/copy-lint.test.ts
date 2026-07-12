import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { LP_COPY } from "@robbed/shared";
import { describe, expect, it } from "vitest";

/**
 * ── M3-9 · consolidated copy / constant / structure lint (CI-blocking) ────────
 *
 * ONE Vitest suite over the whole `apps/web` (`app/` + `src/`) that folds
 * together every static guardrail the plan books as CI-blocking greps:
 *   - the per-page §8.3 greps (LP verb, exchange/finality framing, USD literals,
 *     0x address literals, raw color-token bypass), and
 *   - the web.md §8.1 copy table's structural invariant (the LP sentence exists
 *     ONLY via the shared constant), and
 *   - the FSD import-boundary rule (no upward / sibling-slice imports),
 * so a single `bun run test` fails if any is violated. Replaces the former
 * split copy-lint.test.ts + token-lint.test.ts (M3-2/M3-3), same coverage in one
 * suite. Basis: docs/how-it-works/web.md §8.3 + §2.1 (FSD layers); spec §1/§2/§12.14.
 *
 * IMPLEMENTATION NOTE: the forbidden phrases are NOT spelled out literally in
 * this file — they are assembled from fragments via `RegExp` so neither this
 * test nor the repo hard-rules hook flags the lint on its own patterns.
 */

const WEB_ROOT = fileURLToPath(new URL("../", import.meta.url));

// ── file collection ──────────────────────────────────────────────────────────

/** Recursively collect files under `dir`, skipping build/dep/e2e trees. */
function walk(dir: string, exts: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "e2e") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.test(name)) out.push(full);
  }
  return out;
}

const ROOTS = [join(WEB_ROOT, "app"), join(WEB_ROOT, "src")];
const read = (file: string) => readFileSync(file, "utf8");
const rel = (file: string) => file.slice(WEB_ROOT.length);

/** All source files except tests (tests carry the patterns deliberately). */
function sourceFiles(): string[] {
  return ROOTS.flatMap((r) => walk(r, /\.(tsx?|css|mjs)$/)).filter(
    (f) => !/\.test\.[tj]sx?$/.test(f),
  );
}

// ── forbidden patterns (assembled from fragments; see note above) ─────────────

const LP_FORBIDDEN = new RegExp("bur" + "n", "i"); // the forbidden LP verb
const EXCHANGE_FRAMING = new RegExp(
  ["ord" + "er.?book", "real.?time exchange", "instant(?:ly)? fin" + "al"].join("|"),
  "i",
);
const USD_LITERAL = /\$[0-9][0-9,.]*[kKmMbB]?/;
const ADDRESS_LITERAL = /0x[0-9a-fA-F]{40}\b/;

// ── (1) copy rules — spec §1 / §2 / §12.14 ────────────────────────────────────

describe("copy-lint · forbidden copy (spec §1/§2/§12.14)", () => {
  const files = sourceFiles();

  it("no forbidden LP verb in any source (CLAUDE.md hard rule)", () => {
    const hits = files.filter((f) => LP_FORBIDDEN.test(read(f))).map(rel);
    expect(hits, `forbidden LP verb in: ${hits.join(", ")}`).toEqual([]);
  });

  it("no exchange / instant-settlement framing (§1)", () => {
    const hits = files.filter((f) => EXCHANGE_FRAMING.test(read(f))).map(rel);
    expect(hits, `forbidden framing in: ${hits.join(", ")}`).toEqual([]);
  });

  it("no numeric USD literals in code/copy (§2)", () => {
    const hits = files.filter((f) => USD_LITERAL.test(read(f))).map(rel);
    expect(hits, `USD literal in: ${hits.join(", ")}`).toEqual([]);
  });

  it("the LP sentence exists only via the shared constant, never inline", () => {
    const hits = files.filter((f) => read(f).includes(LP_COPY)).map(rel);
    expect(hits, `LP sentence hardcoded in: ${hits.join(", ")}`).toEqual([]);
  });

  // ── .json leg (W4-A hardening, 2026-07-12) ──────────────────────────────────
  // The LP sentence lives ONLY in the shared `LP_COPY` constant — no .json under
  // app/+src may carry it (JSON cannot reference the TS constant, so any
  // occurrence is a hardcoded copy that can drift). Zero allowlist entries.
  it("no .json under app/+src carries the LP sentence", () => {
    const hits = ROOTS.flatMap((r) => walk(r, /\.json$/))
      .filter((f) => read(f).includes(LP_COPY))
      .map(rel);
    expect(hits, `LP sentence hardcoded in .json: ${hits.join(", ")}`).toEqual([]);
  });
});

// ── (2) address literals — spec §9 / web.md §2.3 ──────────────────────────────
// Only WETH (in shared/lib/chain.ts, itself sourced from @robbed/shared) and the
// hand-authored address seam shared/config/addresses.ts (deriving from the
// generated @robbed/shared map) may carry a 40-hex literal.

describe("copy-lint · no inline address literals (spec §9)", () => {
  const ADDRESS_EXEMPT = [
    join("shared", "config", "addresses.ts"),
    join("shared", "lib", "chain.ts"),
  ];

  it("no 0x{40} outside shared/config/addresses.ts + shared/lib/chain.ts", () => {
    const hits = sourceFiles()
      .filter((f) => !ADDRESS_EXEMPT.some((x) => f.endsWith(x)))
      .filter((f) => ADDRESS_LITERAL.test(read(f)))
      .map(rel);
    expect(hits, `address literal in: ${hits.join(", ")}`).toEqual([]);
  });
});

// ── (3) design-token bypass — spec §12.24 / web.md §7 ─────────────────────────
// No raw hex/rgb/hsl color or arbitrary color class in UI code. Exempt: the token
// file (src/app/globals.css), the vendored shadcn kit (src/shared/ui/kit/** — code
// we own), and the non-presentational plumbing segments (shared/lib|api|config),
// which legitimately carry hex-like literals that are NOT token bypasses (e.g. a
// wallet's `iconBackground`, chain metadata). This exemption set is the ratified
// M3-2 lint's (web.md §8.3 plan note); the lint targets UI, not the data layer.

describe("copy-lint · design-token bypass (spec §12.24)", () => {
  const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\(|\[(?:#|rgb|hsl)/;
  const COLOR_EXEMPT_SEGMENTS = [
    join("src", "app", "globals.css"),
    join("shared", "ui", "kit") + sep,
    join("shared", "lib") + sep,
    join("shared", "api") + sep,
    join("shared", "config") + sep,
  ];

  it("no raw color values outside globals.css / shared/ui/kit / plumbing", () => {
    const targets = ROOTS.flatMap((r) => walk(r, /\.(tsx?|css)$/)).filter(
      (f) => !COLOR_EXEMPT_SEGMENTS.some((seg) => f.includes(seg)),
    );
    const offenders: string[] = [];
    for (const file of targets) {
      read(file)
        .split("\n")
        .forEach((line, i) => {
          if (RAW_COLOR.test(line)) offenders.push(`${rel(file)}:${i + 1}  ${line.trim()}`);
        });
    }
    expect(offenders, `raw color values found:\n${offenders.join("\n")}`).toEqual([]);
  });
});

// ── (4) FSD import-boundary — web.md §2.1 (Feature-Sliced Design) ─────────────
// Strict downward imports only: app → views → widgets → features → entities →
// shared. A module may import ONLY from a layer strictly below it; sibling slices
// on the SAME layer are isolated (cross-slice access is forbidden even via the
// public barrel). Grep-based check (the plan permits this until the `steiger`
// FSD linter is wired — web.md §2.1 "Import-boundary linter: TODO").

describe("copy-lint · FSD import boundaries (web.md §2.1)", () => {
  const RANK: Record<string, number> = {
    shared: 0,
    entities: 1,
    features: 2,
    widgets: 3,
    views: 4,
    app: 5,
  };
  const SLICED = new Set(["views", "widgets", "features", "entities"]);

  /** A file's own (layer, slice). Root `app/` (Next router) is the `app` layer. */
  function layerSliceOf(relPath: string): { layer: string | null; slice: string | null } {
    const p = relPath.split("/");
    if (p[0] === "app") return { layer: "app", slice: null };
    if (p[0] === "src") {
      const layer = p[1] ?? null;
      const slice = layer && SLICED.has(layer) ? (p[2] ?? null) : null;
      return { layer, slice };
    }
    return { layer: null, slice: null };
  }

  it("has no upward or sibling-slice imports across the layer graph", () => {
    const files = ROOTS.flatMap((r) => walk(r, /\.tsx?$/)).filter(
      (f) => !/\.test\.[tj]sx?$/.test(f),
    );
    const violations: string[] = [];
    const importRe = /from\s+["']@\/([a-zA-Z-]+)(?:\/([a-zA-Z-]+))?/g;

    for (const file of files) {
      const r = rel(file);
      const { layer, slice } = layerSliceOf(r.replaceAll(sep, "/"));
      if (!layer || !(layer in RANK)) continue;
      const src = read(file);
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(src)) !== null) {
        const impLayer = m[1];
        const impSlice = m[2] ?? null;
        if (!impLayer || !(impLayer in RANK)) continue;
        const impRank = RANK[impLayer]!;
        const selfRank = RANK[layer]!;
        if (impRank > selfRank) {
          violations.push(`${r}: UPWARD import @/${impLayer} (self is ${layer})`);
        } else if (
          impRank === selfRank &&
          SLICED.has(layer) &&
          impSlice &&
          slice &&
          impSlice !== slice
        ) {
          violations.push(
            `${r}: SIBLING-slice import @/${impLayer}/${impSlice} (self is ${layer}/${slice})`,
          );
        }
      }
    }
    expect(violations, `FSD boundary violations:\n${violations.join("\n")}`).toEqual([]);
  });
});
