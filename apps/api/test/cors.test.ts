/**
 * Public-surface CORS (api.md; mw/cors.ts). Asserts the four normative
 * behaviors empirically (never trusted from docs):
 *  1. OPTIONS preflight succeeds on the browser-POSTed routes (uploads,
 *     metadata) — the pre-fix behavior was a 404 (no OPTIONS routes), which
 *     blocked every upload from the public web origins.
 *  2. Allowed origin is echoed (exact, case-insensitive match; Vary: Origin);
 *     Retry-After is exposed for the 429 backoff path.
 *  3. Disallowed origins (and origin-less requests) get NO
 *     Access-Control-Allow-Origin — never `*`.
 *  4. The SIWE cookie surface (/v1/admin/*, /internal/*) is NEVER opened
 *     cross-origin, even for allowed origins.
 */
import { describe, expect, it } from "bun:test";
import { createApp } from "../src/app";
import { makeTestDeps } from "./helpers";

const app = createApp(makeTestDeps());
const ALLOWED = "https://web.test"; // testConfig corsAllowedOrigins
const EVIL = "https://evil.example";

function preflight(path: string, origin: string, method = "POST"): Response | Promise<Response> {
  return app.request(
    new Request(`http://x${path}`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": "content-type",
      },
    }),
  );
}

describe("CORS — preflight on browser-POSTed routes (bug fix)", () => {
  it("OPTIONS /v1/uploads/image → 204 with allow-origin/methods/headers (was 404)", async () => {
    const res = await preflight("/v1/uploads/image", ALLOWED);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect(res.headers.get("access-control-allow-methods") ?? "").toContain("POST");
    expect((res.headers.get("access-control-allow-headers") ?? "").toLowerCase()).toContain("content-type");
    expect(res.headers.get("access-control-max-age")).toBe("86400");
  });

  it("OPTIONS /v1/metadata → 204 with allow-origin (application/json POST is preflighted)", async () => {
    const res = await preflight("/v1/metadata", ALLOWED);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
  });

  it("no credentials header on the cookie-less public surface", async () => {
    const res = await preflight("/v1/uploads/image", ALLOWED);
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

describe("CORS — actual requests on the public surface", () => {
  it("GET /v1/tokens with an allowed Origin echoes it + Vary: Origin + exposes Retry-After", async () => {
    const res = await app.request(
      new Request("http://x/v1/tokens", { headers: { Origin: ALLOWED } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect((res.headers.get("vary") ?? "").toLowerCase()).toContain("origin");
    expect((res.headers.get("access-control-expose-headers") ?? "").toLowerCase()).toContain("retry-after");
  });

  it("origin matching is case-insensitive and echoes the request's exact value", async () => {
    const mixed = "https://WEB.test";
    const res = await app.request(
      new Request("http://x/v1/tokens", { headers: { Origin: mixed } }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe(mixed);
  });

  it("a disallowed Origin gets NO allow-origin header (and never `*`)", async () => {
    const res = await app.request(
      new Request("http://x/v1/tokens", { headers: { Origin: EVIL } }),
    );
    expect(res.status).toBe(200); // same-network reads still work; the BROWSER blocks
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("a disallowed Origin's preflight carries no allow-origin either", async () => {
    const res = await preflight("/v1/uploads/image", EVIL);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("an origin-less (non-CORS) request is untouched", async () => {
    const res = await app.request(new Request("http://x/v1/tokens"));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("CORS — SIWE cookie surface stays same-origin only (api.md scoping)", () => {
  it("/v1/admin/* is never opened: preflight gets no CORS headers", async () => {
    const res = await preflight("/v1/admin/login", ALLOWED);
    // No OPTIONS route + middleware skips ⇒ the 404 handler, with NO allow-origin.
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("/v1/admin/nonce GET with an allowed Origin gets no allow-origin", async () => {
    const res = await app.request(
      new Request("http://x/v1/admin/nonce", { headers: { Origin: ALLOWED } }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("/internal/* is never opened", async () => {
    const res = await app.request(
      new Request("http://x/internal/competitor-snapshots", { headers: { Origin: ALLOWED } }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
