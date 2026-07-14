/**
 * OpenAPI ⇄ Hono ENDPOINT-FOR-ENDPOINT sync (W3/M2-2 hardening — upgrades the
 * old membership-style assertions to a full two-directional route-inventory
 * diff). Walks the LIVE Hono route table (`app.routes`, a public Hono 4 API —
 * verified against hono 4.12.28 typings: `RouterRoute { basePath, path,
 * method, handler }`; middleware registers under method "ALL" and is filtered
 * out) and compares it against the `paths` section of `openapi.yaml` in BOTH
 * directions:
 *
 *   1. every implemented (method, path) is documented, and
 *   2. every documented (method, path) is implemented.
 *
 * Removing a path from the yaml OR adding an undocumented route fails this
 * test — proven by mutation during W3 (delete a yaml path → red; restore →
 * green). The yaml `paths:` block is extracted with a minimal indentation
 * walker instead of a YAML dependency: path keys are exactly-2-space-indented
 * `/...:` lines, methods exactly-4-space-indented HTTP verbs — the file is
 * redocly-linted in CI, so this layout is stable by construction.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../src/app";
import { makeTestDeps } from "./helpers";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);

/**
 * Deliberate Hono-path → documented-path aliases. ONLY entry: the OG card
 * route matches `/v1/og/:file` at runtime (accepts `{address}` and
 * `{address}.png`), while the contract documents the canonical
 * `/v1/og/{address}.png` form (api.md).
 */
const ALIASES: Record<string, string> = {
  "/v1/og/{file}": "/v1/og/{address}.png",
};

/** Hono `:param` → OpenAPI `{param}`; apply the documented aliases. */
function honoToOpenapi(path: string): string {
  const converted = path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  return ALIASES[converted] ?? converted;
}

function implementedEndpoints(): Set<string> {
  const app = createApp(makeTestDeps());
  const out = new Set<string>();
  for (const r of app.routes) {
    if (r.method === "ALL") continue; // middleware (`app.use`) registrations
    out.add(`${r.method.toLowerCase()} ${honoToOpenapi(r.path)}`);
  }
  return out;
}

function documentedEndpoints(): Set<string> {
  const yaml = readFileSync(join(import.meta.dir, "..", "openapi.yaml"), "utf8");
  const lines = yaml.split("\n");
  const out = new Set<string>();
  let inPaths = false;
  let currentPath: string | null = null;
  for (const line of lines) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (inPaths && /^[A-Za-z]/.test(line)) break; // next top-level key (components:)
    if (!inPaths) continue;
    const pathMatch = line.match(/^ {2}(\/[^\s:]*):\s*$/);
    if (pathMatch?.[1]) {
      currentPath = pathMatch[1];
      continue;
    }
    const methodMatch = line.match(/^ {4}([a-z]+):\s*$/);
    if (methodMatch?.[1] && currentPath && HTTP_METHODS.has(methodMatch[1])) {
      out.add(`${methodMatch[1]} ${currentPath}`);
    }
  }
  return out;
}

describe("openapi.yaml ⇄ Hono route table — endpoint-for-endpoint (M2-2)", () => {
  const implemented = implementedEndpoints();
  const documented = documentedEndpoints();

  it("parses a plausible inventory from both sides (guards the extractors)", () => {
    // If either extractor silently broke, both directions would pass vacuously.
    expect(implemented.size).toBeGreaterThanOrEqual(25);
    expect(documented.size).toBeGreaterThanOrEqual(25);
    expect(documented.has("get /v1/tokens")).toBe(true);
    expect(implemented.has("get /v1/tokens")).toBe(true);
  });

  it("every implemented route is documented in openapi.yaml", () => {
    const undocumented = [...implemented].filter((e) => !documented.has(e)).sort();
    expect(undocumented).toEqual([]);
  });

  it("every documented path is implemented by the Hono app", () => {
    const unimplemented = [...documented].filter((e) => !implemented.has(e)).sort();
    expect(unimplemented).toEqual([]);
  });
});
